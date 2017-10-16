import {
  Kind,
  Source,
  ASTNode,
  NameNode,
  ValueNode,
  FieldNode,
  NamedTypeNode,
  DirectiveNode,
  SelectionSetNode,
  OperationTypeNode,
  TypeDefinitionNode,
  FragmentDefinitionNode,
  OperationDefinitionNode,

  GraphQLSchema,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLResolveInfo,

  parse,
  visit,
  printSchema,
  extendSchema,
  buildASTSchema,
} from 'graphql';

import {
  isEqual,
  mapValues,
} from 'lodash';

import {
  exportDirective,
  getSendDirective,
  getExportDirective,
  getResolveWithDirective,
} from './directives';

import { ProxyCall, ProxyContext } from './ProxyContext';

import {
  astToJSON,
  isBuiltinType,
  keyByNameNodes,
  stubSchema,
  SplittedAST,
  splitAST,
  visitWithResultPath,
  extractByPath,
  nameNode,
  jsonToAST,
  makeASTDocument,

  selectionSetNode,

  prefixAlias,
  typeNameAlias,
  prefixTopLevelFields,
  makeInlineVariablesVisitor,
} from './utils';

export type RemoteSchema = {
  schema: GraphQLSchema,
  prefix?: string
};

export type RemoteSchemasMap = { [schemaName: string]: RemoteSchema };

export type ResolveWithArgs = {
  query: ProxyOperation;
  argumentsFragment?: ArgumentsFragment;
};

export class GraphQLJoinSchema {
  schema: GraphQLSchema;
  joinToOrigin: { [ joinName: string ]: { [ schemaName: string ]: string  } };
  originToJoin: { [ schemaName: string ]: { [ originName: string ]: string } };
  resolveWithMap: {
    [ typeName: string ]: {
      [ fieldName: string ]: ResolveWithArgs;
    };
  };

  constructor(
    joinIDL: string | Source,
    remoteSchemas: RemoteSchemasMap
  ) {
    if (typeof joinIDL !== 'string' && !(joinIDL instanceof Source)) {
      throw new TypeError('Must provide joinIDL. Received: ' + String(joinIDL));
    }
    // FIXME: validate remoteSchemas

    const joinDefs = splitAST(parse(joinIDL));
    const remoteTypes = getRemoteTypes(remoteSchemas, joinDefs);
    this.schema = buildSchemaFromIDL({
      ...joinDefs,
      types: [
        ...joinDefs.types,
        ...remoteTypes.map(type => type.ast),
      ],
    });

    stubSchema(this.schema, {
      resolve: fieldResolver,
      resolveType: typeResolver,
    });

    this.joinToOrigin = {};
    this.originToJoin = {};
    for (const { ast, originNames } of remoteTypes) {
      const typeName = ast.name.value;

      this.joinToOrigin[typeName] = originNames;
      for (const [originAPI, originName] of Object.entries(originNames)) {
        this.originToJoin[originAPI] = {
          ...this.originToJoin[originAPI],
          [originName]: typeName,
        };
      }
    }

    const operations = mapValues(
      keyByNameNodes(joinDefs.operations),
      op => new ProxyOperation(op)
    );
    const fragments = mapValues(
      keyByNameNodes(joinDefs.fragments),
      f => new ArgumentsFragment(f)
    );

    this.resolveWithMap = {};
    for (const type of Object.values(this.schema.getTypeMap())) {
      if (type instanceof GraphQLObjectType) {
        for (const field of Object.values(type.getFields())) {
          const resolveWithArgs = getResolveWithDirective(field.astNode);
          if (resolveWithArgs) {
            const { query, extraArgs } = resolveWithArgs;
            const argsFragment = extraArgs && extraArgs.fromFragment;
            this.resolveWithMap[type.name] = {
              ...this.resolveWithMap[type.name],
              [field.name]: {
                query: operations[query],
                argumentsFragment:
                  argsFragment !== undefined ? fragments[argsFragment] : undefined,
              }
            };
          }
        }
      }
    }

  }
}

function getRemoteTypes(
  remoteSchemas: RemoteSchemasMap,
  joinDefs: SplittedAST,
) {
  const remoteTypes = {} as {
    [typeName: string]: {
      ast: TypeDefinitionNode,
      originNames: { [schemaName: string]: string },
    }
  };
  const extTypeRefs = getExternalTypeNames(joinDefs);
  for (const [schemaName, {schema, prefix = ''}] of Object.entries(remoteSchemas)) {
    const typesToExtract = extTypeRefs
      .filter(name => name.startsWith(prefix))
      .map(name => name.replace(prefix, ''));

    const extractedTypes = getTypesWithDependencies(schema, typesToExtract);
    for (const originAST of extractedTypes) {
      const originName = originAST.name.value;
      const joinAST = addPrefixToTypeNode(originAST, prefix)
      const joinName = joinAST.name.value;
      const sameType = remoteTypes[joinName];
      if (sameType) {
        if (!isEqual(sameType.ast, joinAST)) {
          // FIXME: better errors
          throw Error(`Type confict for ${joinName}`);
        }
        sameType.originNames[schemaName] = originName;
      } else {
        remoteTypes[joinName] = {
          ast: joinAST,
          originNames: {
            [schemaName]: originName,
          },
        };
      }
    }
  }
  return Object.values(remoteTypes);
}

function typeResolver(
  rootValue: object,
  context: ProxyContext
) {
  const {originToJoin} = context.joinSchema;
  for (const [schemaName, mapper] of Object.entries(originToJoin)) {
    const typename = rootValue[typeNameAlias(schemaName)];
    if (typename) {
      return mapper[typename];
    }
  }
  throw Error('Can not map rootValue to typename');
}

async function fieldResolver(
  rootValue: object,
  args: object,
  context: ProxyContext,
  info: GraphQLResolveInfo
) {
  const resolveWith =
    context.getResolveWithArgs(info.parentType.name, info.fieldName);

  if (resolveWith) {
    const { query, argumentsFragment } = resolveWith as ResolveWithArgs;
    const queryArgs = {
      ...args,
      ...(argumentsFragment ? argumentsFragment.extractArgs(rootValue) : {}),
    };
    return context.proxyToRemote(query.makeProxyCall(queryArgs), info);
  }

  // TODO: remove '!' after PR is merged
  const isRoot = (info.path!.prev === undefined);
  if (isRoot) {
    return proxyRootField(context, args, info);
  }

  // proxy value or Error instance injected by the proxy
  // TODO: remove '!' after PR is merged
  const key = info.path!.key as string;
  return rootValue[prefixAlias(key)] || rootValue[key];
}

class ArgumentsFragment {
  _selectionSet: SelectionSetNode;
  _exportPaths: { [name: string]: string[] };
  _typeCondition: NamedTypeNode;

  constructor(fragment: FragmentDefinitionNode) {
    this._exportPaths = {};

    const fieldPrefix = `___f_${fragment.name.value}_`;
    const selectionSet = prefixTopLevelFields(fragment.selectionSet, fieldPrefix);
    const resultPath = [];
    this._selectionSet = visit(selectionSet, visitWithResultPath(resultPath, {
      [Kind.FIELD]: (node: FieldNode) => {
        const args = getExportDirective(node);
        if (args) {
          this._exportPaths[args.as] = [...resultPath];
        }
      },
      [Kind.DIRECTIVE]: (node: DirectiveNode) => {
        if (node.name.value === exportDirective.name) {
          return null;
        }
      }
    }));
  }

  injectIntoSelectionSet(selectionSet: SelectionSetNode): SelectionSetNode {
    return selectionSetNode([
      ...selectionSet.selections,
      ...this._selectionSet.selections,
    ]);
  }

  extractArgs(rootValue: object): object {
    const args = Object.create(null);
    for (const [name, path] of Object.entries(this._exportPaths)) {
      const value = extractByPath(rootValue, path);
      if (value instanceof Error) {
        throw value;
      } else if (value !== undefined) {
        args[name] = value;
      }
    }
    return args;
  }
}

function proxyRootField(
  context: ProxyContext,
  args: object,
  info: GraphQLResolveInfo
): any {
  const { parentType, fieldName, operation } = info;
  // Root type always have only one origin type
  const originAPI = Object.keys(context.joinSchema.joinToOrigin[parentType.name])[0];

  return context.proxyToRemote({
    sendTo: originAPI,
    operationType: operation.operation,
    makeSelectionSet: (clientSelection) => selectionSetNode([{
      kind: Kind.FIELD,
      name: nameNode(fieldName),
      arguments: Object.entries(args).map(([name,value]) => ({
        kind: Kind.ARGUMENT,
        name: nameNode(name),
        value: jsonToAST(value),
      })),
      selectionSet: clientSelection,
    }]),
    resultPath: [fieldName],
  }, info);
}

class ProxyOperation {
  _sendTo: string;
  _operationType: OperationTypeNode;
  _resultPath: string[];
  _defaultVars: object;
  _selectionSet: SelectionSetNode;

  constructor(operationDef: OperationDefinitionNode) {
    this._sendTo = getSendDirective(operationDef)!.to;
    this._operationType = operationDef.operation;
    this._selectionSet = operationDef.selectionSet;

    this._defaultVars = {};
    for (const varDef of (operationDef.variableDefinitions || [])) {
      const varName = varDef.variable.name.value;
      const defaultValue = varDef.defaultValue;
      if (defaultValue) {
        this._defaultVars[varName] = astToJSON(defaultValue);
      }
    }

    this._resultPath = [];
    const currentResultPath = [];
    visit(operationDef, visitWithResultPath(currentResultPath, {
      [Kind.FIELD]: (node) => {
        if (currentResultPath.length > this._resultPath.length) {
          this._resultPath = [...currentResultPath];
        }
      },
    }));
  }

  makeProxyCall(args: object): ProxyCall {
    return {
      sendTo: this._sendTo,
      operationType: this._operationType,
      resultPath: this._resultPath,
      makeSelectionSet:
        (clientSelection) => this._makeSelection(args, clientSelection),
    };
  }

  _makeSelection(
    args: object,
    clientSelection?: SelectionSetNode
  ): SelectionSetNode {
    return visit(this._selectionSet, {
      ...makeInlineVariablesVisitor({
        ...this._defaultVars,
        ...args,
      }),
      [Kind.SELECTION_SET]: (node: SelectionSetNode) => {
        const selections = node.selections;
        if (selections[0] && selections[0].kind === Kind.FRAGMENT_SPREAD) {
          return clientSelection;
        }
      },
    });
  }
}

function schemaToASTTypes(
  schema: GraphQLSchema
): TypeDefinitionNode[] {
  const idl = printSchema(schema);
  const ast = parse(idl, { noLocation: true });
  const types = splitAST(ast).types;
  return types.filter(type => !isBuiltinType(type.name.value));
}

function buildSchemaFromIDL(defs: SplittedAST) {
  const idl = makeASTDocument([
    ...defs.schemas,
    ...defs.types,
  ]);

  let schema = buildASTSchema(idl);

  const extensionsAST = makeASTDocument(defs.typeExtensions);
  return extendSchema(schema, extensionsAST);
}

function addPrefixToTypeNode(
  type: TypeDefinitionNode,
  prefix?: string
) {
  if (!prefix) {
    return type;
  }

  return {
    ...visitTypeReferences(
      type,
      node => ({ ...node, name: prefixName(node.name) })
    ),
    name: prefixName(type.name)
  };

  function prefixName(node: NameNode): NameNode {
    const name = node.value;
    return isBuiltinType(name) ? node : { ...node, value: prefix + name };
  }
}

function visitTypeReferences<T extends TypeDefinitionNode>(
  type: T,
  cb: (ref: NamedTypeNode) => void | false | NamedTypeNode
): T {
  return visit(type, {
    [Kind.NAMED_TYPE]: cb,
  });
}

function getTypesWithDependencies(
  schema: GraphQLSchema,
  requiredTypes: string[]
): TypeDefinitionNode[] {
  const typesMap = keyByNameNodes(schemaToASTTypes(schema));

  const returnTypes = [
    ...requiredTypes.filter(typeName => typesMap[typeName])
  ];

  for (const typeName of returnTypes) {
    visitTypeReferences(typesMap[typeName], ref => {
      const refType = ref.name.value;
      if (!returnTypes.includes(refType) && !isBuiltinType(refType)) {
        returnTypes.push(refType);
      }
    });
  }
  return returnTypes.map(typeName => typesMap[typeName]);
}

function getExternalTypeNames(definitions: SplittedAST): string[] {
  const seenTypes = {};
  markTypeRefs(definitions.schemas);
  markTypeRefs(definitions.types);
  markTypeRefs(definitions.typeExtensions);

  const ownTypes = (definitions.types || []).map(type => type.name.value);
  return Object.keys(seenTypes).filter(type => !ownTypes.includes(type));

  function markTypeRefs(defs) {
    defs.forEach(def => visitTypeReferences(def, ref => {
      const name = ref.name.value;
      if (!isBuiltinType(name)) {
        seenTypes[name] = true;
      }
    }));
  }
}
