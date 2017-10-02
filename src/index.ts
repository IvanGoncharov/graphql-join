import { GraphQLClient } from 'graphql-request';
import {
  Kind,
  Source,
  ASTNode,
  NameNode,
  ValueNode,
  FieldNode,
  VariableNode,
  DocumentNode,
  NamedTypeNode,
  DirectiveNode,
  SelectionSetNode,
  OperationTypeNode,
  TypeDefinitionNode,
  FragmentSpreadNode,
  FragmentDefinitionNode,
  VariableDefinitionNode,
  OperationDefinitionNode,

  ExecutionResult,
  GraphQLSchema,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLResolveInfo,
  IntrospectionQuery,

  isAbstractType,
  getNamedType,

  TypeInfo,
  print,
  parse,
  visit,
  visitWithTypeInfo,
  buildClientSchema,
  introspectionQuery,
} from 'graphql';

import {
  mapValues,
  set as pathSet,
  get as pathGet,
} from 'lodash';

import {
  exportDirective,
  getSendDirective,
  getExportDirective,
  getResolveWithDirective,
} from './directives';

import {
  keyByNameNodes,
  stubSchema,
  splitAST,
  injectErrors,
  injectTypename,
  makeASTDocument,
  schemaToASTTypes,
  addPrefixToTypeNode,
  getExternalTypeNames,
  getTypesWithDependencies,
  buildSchemaFromSDL,
  visitWithResultPath,
  extractByPath,
  nameNode,
  jsonToAST,

  mergeSelectionSets,
  selectionSetNode,

  prefixAlias,
  typeNameAlias,
} from './utils';

// PROXY:
// timeout
// ratelimiting for proxy queries
// proxy Relay node, ID => ${schemaName}/ID
// GLOBAL TODO:
//   - check that mutation is executed in sequence
//   - handle 'argumentsFragment' on root fields

export type SchemaProxyFn =
  (query: DocumentNode, variableValues?: object) => Promise<ExecutionResult>;
export type SchemaProxyFnMap = { [schemaName: string]: SchemaProxyFn };
export type RemoteSchema = {
  schema: GraphQLSchema,
  prefix?: string
};
export type RemoteSchemasMap = { [schemaName: string]: RemoteSchema };

function makeProxy(settings): SchemaProxyFn {
  const { url, headers } = settings;
  const client = new GraphQLClient(url, { headers });
  return async (queryDocument: DocumentNode, variableValues?: object) => {
    // FIXME: conver errors
    // FIXME: better client
    const query = print(queryDocument);
    const data = await client.request(query, variableValues);
    return { data } as ExecutionResult;
  };
}

const parsedIntrospectionQuery = parse(introspectionQuery);
export async function getRemoteSchemas(
  endpoints: EndpointMap
): Promise<{remoteSchemas: RemoteSchemasMap, proxyFns: SchemaProxyFnMap}> {
  const promises = Object.entries(endpoints).map(
    async ([name, endpoint]) => {
      const {prefix, ...settings} = endpoint;
      const proxyFn = makeProxy(settings);
      const introspectionResult = await proxyFn(parsedIntrospectionQuery, {});
      const introspection = introspectionResult.data as IntrospectionQuery;
      const schema = buildClientSchema(introspection);

      return {name, remoteSchema: { prefix, schema }, proxyFn };
    }
  );

  return Promise.all(promises).then(result => {
    const remoteSchemas = {};
    const proxyFns = {};
    for (const {name, remoteSchema, proxyFn} of result) {
      remoteSchemas[name] = remoteSchema;
      proxyFns[name] = proxyFn;
    }
    return { remoteSchemas, proxyFns };
  });
}

type Endpoint = {
  prefix?: string
  url: string
  headers?: {[name: string]: string}
};
export type EndpointMap = { [name: string]: Endpoint };

type OriginTypes = { originType: GraphQLNamedType, originAPI: string }[];

export class GraphQLJoinSchema {
  schema: GraphQLSchema;
  nameMapper: {
    [ name: string ]: {
      joinToOrigin: { [ joinName: string ]: string };
      originToJoin: { [ originName: string ]: string };
    }
  };
  originTypesMap: { [ name: string ]: OriginTypes };
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
    const extTypeRefs = getExternalTypeNames(joinDefs);
    const remoteTypes = getRemoteTypes(remoteSchemas, extTypeRefs);
    this.schema = buildSchemaFromSDL({
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

    this.nameMapper = {};
    this.originTypesMap = {};
    for (const { ast, originTypes } of remoteTypes) {
      const typeName = ast.name.value;
      this.originTypesMap[typeName] = originTypes;

      for (const {originAPI, originType} of originTypes) {
        const originName = originType.name;
        pathSet(this.nameMapper,[originAPI, 'joinToOrigin', typeName], originName);
        pathSet(this.nameMapper,[originAPI, 'originToJoin', originName], typeName);
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
            pathSet(
              this.resolveWithMap,
              [type.name, field.name],
              {
                query: operations[resolveWithArgs.query],
                argumentsFragment: resolveWithArgs.argumentsFragment ?
                  fragments[resolveWithArgs.argumentsFragment] : undefined,
              }
            );
          }
        }
      }
    }

  }
}

function getRemoteTypes(
  remoteSchemas: RemoteSchemasMap,
  extTypeRefs: string[]
) {
  const remoteTypes = [] as {ast: TypeDefinitionNode, originTypes: OriginTypes }[];
  for (const [api, {schema, prefix = ''}] of Object.entries(remoteSchemas)) {
    const typesMap = keyByNameNodes(schemaToASTTypes(schema));

    const typesToExtract = extTypeRefs
      .filter(name => name.startsWith(prefix))
      .map(name => name.replace(prefix, ''))
      .filter(name => typesMap[name]);

    const extractedTypes = getTypesWithDependencies(typesMap, typesToExtract);
    for (const typeName of extractedTypes) {
      // TODO: merge types with same name and definition
      remoteTypes.push({
        ast: addPrefixToTypeNode(typesMap[typeName], prefix),
        originTypes: [{
          originType: schema.getType(typeName),
          originAPI: api,
        }],
      });
    }
  }
  return remoteTypes;
}

type ResolveWithArgs = {
  query: ProxyOperation;
  argumentsFragment?: ArgumentsFragment;
};

function typeResolver(
  rootValue: object,
  context: ProxyContext
) {
  const {nameMapper} = context.joinSchema;
  for (const [schemaName, mapper] of Object.entries(nameMapper)) {
    const typename = rootValue[typeNameAlias(schemaName)];
    if (typename) {
      return mapper.originToJoin[typename];
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

  const isRoot = (info.path.prev === undefined);
  if (isRoot) {
    return proxyRootField(context, args, info);
  }

  // proxy value or Error instance injected by the proxy
  const key = info.path.key as string;
  return rootValue[prefixAlias(key)] || rootValue[key];
}

export class ProxyContext {
  constructor(
    public joinSchema: GraphQLJoinSchema,
    private proxyFns: SchemaProxyFnMap
  ) {
    // FIXME: validate proxyFns
  }

  getResolveWithArgs(
    typeName: string,
    fieldName: string
  ): ResolveWithArgs | undefined {
    return pathGet(this.joinSchema.resolveWithMap, [typeName, fieldName]);
  }

  async proxyToRemote(
    call: ProxyCall,
    info: GraphQLResolveInfo
  ): Promise<ExecutionResult> {
    const query = this.makeQuery(call, info);
    const proxyFn = this.proxyFns[call.sendTo];
    const result = await proxyFn(query, info.variableValues);
    const data = injectErrors(result);
    return extractByPath(data, call.resultPath);
  }

  makeQuery(
    call: ProxyCall,
    info: GraphQLResolveInfo
  ): DocumentNode {
    const sendTo = call.sendTo;
    const nameMapper = this.joinSchema.nameMapper[call.sendTo];
    const seenVariables = {};

    const selection = mergeSelectionSets(info.fieldNodes);
    const typeInfo = new TypeInfo(info.schema);
    const rootType = getNamedType(info.returnType);
    typeInfo['_typeStack'].push(rootType);

    const clientSelection = visit(selection, visitWithTypeInfo(typeInfo, {
      [Kind.VARIABLE]: (node: VariableNode) => {
        seenVariables[node.name.value] = true;
      },
      [Kind.NAME]: (node: NameNode, key: string) => {
        if (key === 'alias') {
          return nameNode(prefixAlias(node.value));
        }
      },
      [Kind.NAMED_TYPE]: (ref: NamedTypeNode) => {
        const typeName = ref.name.value;
        const originName = nameMapper && nameMapper.joinToOrigin[typeName];
        return { ...ref, name: nameNode(originName || typeName) };
      },
      [Kind.FIELD]: () => {
        const type = typeInfo.getParentType();
        const field = typeInfo.getFieldDef();
        if (field.name.startsWith('__')) {
          return null;
        }
        if (this.getResolveWithArgs(type.name, field.name)) {
          return null;
        }
      },
      // TODO: don't inline fragments
      [Kind.FRAGMENT_SPREAD]: (node: FragmentSpreadNode) => {
        const fragment = info.fragments[node.name.value];
        return {
          kind: Kind.INLINE_FRAGMENT,
          typeCondition: fragment.typeCondition,
          selectionSet: fragment.selectionSet,
          directives: node.directives,
        };
      },
      [Kind.SELECTION_SET]: {
        leave: (node: SelectionSetNode) => {
          const type = typeInfo.getParentType();
          // TODO: should we also handle Interfaces and Unions here?
          if (type instanceof GraphQLObjectType) {
            for (const fieldName of Object.keys(type.getFields())) {
              const resolveWith = this.getResolveWithArgs(type.name, fieldName);
              if (resolveWith && resolveWith.argumentsFragment) {
                node = resolveWith.argumentsFragment.injectIntoSelectionSet(node);
              }
            }
          }

          // FIXME: recursive remove empty selection
          if (isAbstractType(type) || node.selections.length === 0) {
            return injectTypename(node, typeNameAlias(sendTo));
          }
          return node;
        }
      },
    }));

    return makeASTDocument([{
      kind: Kind.OPERATION_DEFINITION,
      operation: call.operationType,
      selectionSet: call.makeSelectionSet(clientSelection),
      variableDefinitions: (info.operation.variableDefinitions || []).filter(
        (varDef: VariableDefinitionNode) => seenVariables[varDef.variable.name.value]
      ),
    }]);
  }
}

class ArgumentsFragment {
  _selectionSet: SelectionSetNode;
  _exportPaths: { [name: string]: string[] };
  _typeCondition: NamedTypeNode;

  constructor(fragment: FragmentDefinitionNode) {
    const { typeCondition, selectionSet } = fragment;
    this._typeCondition = typeCondition;

    this._exportPaths = {};
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
    // FIXME: possible conflicts
    return {
      ...selectionSet,
      selections: [
        ...selectionSet.selections,
        {
          kind: 'InlineFragment',
          selectionSet: this._selectionSet,
          // FIXME: work around for bug in graphql-js should work without
          // see https://github.com/graphql/graphql-js/blob/master/src/validation/rules/PossibleFragmentSpreads.js#L45
          typeCondition: this._typeCondition,
        },
      ],
    };
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

type ProxyCall = {
  sendTo: string;
  operationType: OperationTypeNode;
  makeSelectionSet: (clientSelection?: SelectionSetNode) => SelectionSetNode;
  resultPath: string[];
};

function proxyRootField(
  context: ProxyContext,
  args: object,
  info: GraphQLResolveInfo
): any {
  const { parentType, fieldName, operation } = info;
  const originTypes = context.joinSchema.originTypesMap[parentType.name];
  // Root type always have only one origin type
  const { originAPI } = originTypes[0];

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
  _defaultVarsAST: { [name: string]: ValueNode };
  _selectionSet: SelectionSetNode;

  constructor(operationDef: OperationDefinitionNode) {
    this._sendTo = getSendDirective(operationDef)!.to;
    this._operationType = operationDef.operation;
    this._selectionSet = operationDef.selectionSet;

    this._defaultVarsAST = {};
    for (const varDef of (operationDef.variableDefinitions || [])) {
      const defaultValue = varDef.defaultValue;
      if (defaultValue) {
        this._defaultVarsAST[varDef.variable.name.value] = defaultValue;
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
    const argsAST = {
      ...this._defaultVarsAST,
      ...mapValues(args, value => jsonToAST(value)),
    };

    const removeNodesWithoutValue = {
      leave(node: ASTNode) {
        return (node['value'] == null) ? null : undefined;
      },
    };

    return visit(this._selectionSet, {
      [Kind.SELECTION_SET]: (node: SelectionSetNode) => {
        const selections = node.selections;
        if (selections[0] && selections[0].kind === Kind.FRAGMENT_SPREAD) {
          return clientSelection;
        }
      },
      // Replace variable with AST value or delete if unspecified
      [Kind.VARIABLE]: (node: VariableNode) => (argsAST[node.name.value] || null),
      [Kind.OBJECT_FIELD]: removeNodesWithoutValue,
      [Kind.ARGUMENT]: removeNodesWithoutValue,
    });
  }
}

function validation() {
  // TODO:
  // JOIN AST:
  //   - validate that all directive known and locations are correct
  //   - no specified directives inside join AST
  //   - all references to remote types have no conficts
  //   - all fields inside extends and type defs should have @resolveWith
  //   - all field args + all fragment exports used in operation
  //   - fields return types should match types returned by "query" including LIST and NON_NULL
  //   - TEMPORARY: @resolveWith for root fields shouldn't use fragments
  // schema:
  //   - check for subscription in schema and `Subscription` type and error as not supported
  //   - references to Query and Mutation roots point to exactly one remote type
  //   - reference only roots of the same type from remote schema
  // fragments:
  //   - shoud have uniq names
  //   - shouldn't reference other fragments
  //   - should have atleast one leaf
  //   - all scalars should have exports directive
  //   - names in export directive should be uniq
  //   - should be used in @resolveWith
  //   - no field alliases
  //   - forbid @skip/@include
  //   - TEMPORARY: fragment shouldn't contain fields with @resolveWith
  // operations:
  //   - only query and mutation no subscription
  //   - mutation should be used only on fields in mutation root
  //   - should have name
  //   - shoud have uniq names
  //   - should have @send(to:)
  //   - valid against external schema
  //   - should have exactly one "leaf" which is "{...CLIENT_SELECTION}" or scalar
  //   - don't reference other fragments
  //   - should be used in @resolveWith
  //   - no field alliases
  //   - forbid @skip/@include
}
