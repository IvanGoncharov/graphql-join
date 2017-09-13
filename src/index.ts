import { GraphQLClient } from 'graphql-request';
import {
  Kind,
  FieldNode,
  DocumentNode,
  NamedTypeNode,
  DirectiveNode,
  SelectionSetNode,
  OperationTypeNode,
  TypeDefinitionNode,
  FragmentSpreadNode,
  FragmentDefinitionNode,
  OperationDefinitionNode,

  ExecutionResult,
  GraphQLSchema,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLField,
  GraphQLFieldResolver,
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
} from 'lodash';

import {
  validateDirectives,
  exportDirective,
  getSendDirective,
  getExportDirective,
  getResolveWithDirective,
} from './directives';

import {
  SplittedAST,

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
  fieldToSelectionSet,
  visitWithResultPath,
  extractByPath,

  OperationArgToTypeMap,
  getOperationArgToTypeMap,
  replaceVariablesVisitor,
  mergeSelectionSets,
} from './utils';

// PROXY:
// timeout
// ratelimiting for proxy queries
// proxy Relay node, ID => ${schemaName}/ID
// GLOBAL TODO:
//   - check that mutation is executed in sequence
//   - handle 'argumentsFragment' on root fields

export type SchemaProxyFn = (query: DocumentNode) => Promise<ExecutionResult>;
export type SchemaProxyFnMap = { [schemaName: string]: SchemaProxyFn };
export type RemoteSchema = {
  schema: GraphQLSchema,
  prefix?: string
};
export type RemoteSchemasMap = { [schemaName: string]: RemoteSchema };

function makeProxy(settings): SchemaProxyFn {
  const { url, headers } = settings;
  const client = new GraphQLClient(url, { headers });
  return async (queryDocument: DocumentNode) => {
    // FIXME: conver errors
    // FIXME: better client
    const query = print(queryDocument);
    const data = await client.request(query);
    return { data } as ExecutionResult;
  }
}

const parsedIntrospectionQuery = parse(introspectionQuery);
export async function getRemoteSchemas(
  endpoints: EndpointMap
): Promise<{remoteSchemas: RemoteSchemasMap, proxyFns: SchemaProxyFnMap}> {
  const promises = Object.entries(endpoints).map(
    async ([name, endpoint]) => {
      const {prefix, ...settings} = endpoint;
      const proxyFn = makeProxy(settings);
      const introspection = (await proxyFn(parsedIntrospectionQuery)).data;
      const schema = buildClientSchema(introspection as IntrospectionQuery);

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

type OriginTypes = { type: GraphQLNamedType, originAPI: string }[];

function buildJoinSchema(
  joinDefs: SplittedAST,
  remoteSchemas: RemoteSchemasMap,
): GraphQLSchema {
  const extTypeRefs = getExternalTypeNames(joinDefs);
  const remoteTypes = getRemoteTypes(remoteSchemas, extTypeRefs);
  const schema = buildSchemaFromSDL({
    ...joinDefs,
    types: [
      ...joinDefs.types,
      ...remoteTypes.map(type => type.ast),
    ],
  });

  for (const { ast, originTypes } of remoteTypes) {
    const typeName = ast.name.value;
    schema.getType(typeName)['originTypes'] = originTypes;
  }
  return schema;
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
          type: schema.getType(typeName),
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

export function joinSchemas(
  joinAST: DocumentNode,
  remoteSchemas: RemoteSchemasMap,
): GraphQLSchema {
  const joinDefs = splitAST(joinAST);
  const schema = buildJoinSchema(joinDefs, remoteSchemas);

  const operations = mapValues(
    keyByNameNodes(joinDefs.operations),
    op => new ProxyOperation(op, remoteSchemas)
  );
  const fragments = mapValues(
    keyByNameNodes(joinDefs.fragments),
    f => new ArgumentsFragment(f),
  );

  stubSchema(schema, (type, field) => {
    const rawArgs = getResolveWithDirective(field.astNode);
    if (rawArgs) {
      const args = {
        query: operations[rawArgs.query],
        argumentsFragment: rawArgs.argumentsFragment ?
          fragments[rawArgs.argumentsFragment] : undefined,
      };
      field['resolveWith'] = args;
      field.resolve = resolveWithResolver(args);
    } else {
      field.resolve = fieldResolver;
    }
  });
  return schema;
}

async function fieldResolver(
  rootValue: object,
  args: object,
  context: ProxyContext,
  info: GraphQLResolveInfo,
) {
  const isRoot = (info.path.prev == null);
  if (isRoot) {
    const fieldDef = info.parentType.getFields()[info.fieldName];
    const clientSelection = makeClientSelection(info);
    const result = await context.proxyToRemote(
      // Root type always have only one origin type
      info.parentType['originTypes'][0].originAPI,
      info.operation.operation,
      fieldToSelectionSet(fieldDef, args, clientSelection),
    );
    return extractByPath(injectErrors(result), [fieldDef.name]);
  }

  // proxy value or Error instance injected by the proxy
  return rootValue && rootValue[info.path.key];
}

function resolveWithResolver(
  {query, argumentsFragment}: ResolveWithArgs
): GraphQLFieldResolver<any, any> {
  return async (rootValue, args, context: ProxyContext, info) => {
    const clientSelection = makeClientSelection(info);
    const queryArgs = {
      ...args,
      ...(argumentsFragment ? argumentsFragment.extractArgs(rootValue) : {}),
    };
    return query.call(context, queryArgs, clientSelection);
  }
}

function makeClientSelection(
  info: GraphQLResolveInfo
): SelectionSetNode | undefined {
  const clientSelection = mergeSelectionSets(info.fieldNodes);
  if (!clientSelection) return;

  const {schema, variableValues, fragments, operation} = info;
  const typeInfo = new TypeInfo(schema);
  typeInfo['_typeStack'].push(getNamedType(info.returnType));

  // TODO: cache to do only once per operation
  const argToTypeMap = getOperationArgToTypeMap(schema, operation);

  return visit(clientSelection, visitWithTypeInfo(typeInfo, {
    ...replaceVariablesVisitor(variableValues, argToTypeMap),
    [Kind.FIELD]: () => {
      const field = typeInfo.getFieldDef();
      if (field.name.startsWith('__'))
        return null;
      if (field['resolveWith'])
        return null;
    },
    [Kind.FRAGMENT_SPREAD]: (node: FragmentSpreadNode) => {
      const fragment = fragments[node.name.value];
      return {
        kind: Kind.INLINE_FRAGMENT,
        typeCondition: fragment.typeCondition,
        selectionSet: fragment.selectionSet,
        directives: node.directives,
      }
    },
    [Kind.SELECTION_SET]: {
      leave(node: SelectionSetNode) {
        const type = typeInfo.getParentType()
        // TODO: should we also handle Interfaces and Unions here?
        if (type instanceof GraphQLObjectType) {
          Object.values(type.getFields()).forEach(field => {
            const resolveWith = field['resolveWith'] as ResolveWithArgs | undefined;
            if (!resolveWith) return;

            const {argumentsFragment} = resolveWith;
            if (argumentsFragment) {
              node = argumentsFragment.injectIntoSelectionSet(node);
            }
          });
        }

        if (isAbstractType(type) || node.selections.length === 0)
          return injectTypename(node);
        else
          return node;
      }
    },
  }));
}

export class ProxyContext {
  constructor(
    private proxyFns: SchemaProxyFnMap
  ) {
    //FIXME: validate proxyFns
  }

  proxyToRemote(
    schemaName: string,
    operation: OperationTypeNode,
    selectionSet: SelectionSetNode
  ): Promise<ExecutionResult> {
    const query = makeASTDocument([{
      kind: 'OperationDefinition',
      operation,
      selectionSet,
    }]);
    // FIXME: error if invalid name
    return this.proxyFns[schemaName](query);
  }
}

class ArgumentsFragment {
  _selectionSet: SelectionSetNode;
  _exportPaths: { [name: string]: string[] };
  _typeCondition: NamedTypeNode;

  constructor(fragment: FragmentDefinitionNode) {
    const { name, typeCondition, selectionSet } = fragment;
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
    return  {
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
    return mapValues(this._exportPaths, path => {
      const value = extractByPath(rootValue, path);
      if (value instanceof Error) {
        throw value;
      }
      return value;
    });
  }
}

// FIXME: strip type prefixes from user selection parts and fragments before proxing
// FIXME: strip type prefixes from __typename inside results
class ProxyOperation {
  _sendTo: string;
  _operationType: OperationTypeNode;
  _resultPath: string[];
  _selectionSet: SelectionSetNode;
  _argToType: OperationArgToTypeMap;

  constructor(
    operationDef: OperationDefinitionNode,
    remoteSchemas: RemoteSchemasMap
  ) {
    this._operationType = operationDef.operation;
    this._sendTo = getSendDirective(operationDef)!.to;
    this._selectionSet = operationDef.selectionSet;

    const schema = remoteSchemas[this._sendTo].schema;
    this._argToType = getOperationArgToTypeMap(schema, operationDef);

    const resultPath = [];
    visit(operationDef, visitWithResultPath(resultPath, {
      [Kind.FIELD]: (node) => {
        if (resultPath.length > (this._resultPath || []).length) {
          this._resultPath = [...resultPath];
        }
      },
    }));
  }

  async call(
    context: ProxyContext,
    queryArgs: object,
    clientSelection?: SelectionSetNode
  ): Promise<any> {
    const result = await context.proxyToRemote(
      this._sendTo,
      this._operationType,
      this._wrapSelection(queryArgs, clientSelection),
    );

    const data = injectErrors(result);
    return extractByPath(data, this._resultPath);
  }

  _wrapSelection(args: object, clientSelection?: SelectionSetNode): SelectionSetNode {
    return visit(this._selectionSet, {
      ...replaceVariablesVisitor(args, this._argToType),
      [Kind.SELECTION_SET]: (node: SelectionSetNode) => {
        const selections = node.selections;
        if (selections[0] && selections[0].kind === Kind.FRAGMENT_SPREAD) {
          return clientSelection;
        }
      },
    });
  }
}

function validation() {
  // TODO:
  // JOIN AST:
  //   - check for subscription in schema and `Subscription` type and error as not supported
  //   - validate that all directive known and locations are correct
  //   - no specified directives inside join AST
  //   - all references to remote types have no conficts
  //   - references to Query and Mutation roots point to exactly one remote type
  //   - all fields inside extends and type defs should have @resolveWith
  //   - all field args + all fragment exports used in operation
  //   - fields return types should match types returned by "query" including LIST and NON_NULL
  // fragments:
  //   - shoud have uniq names
  //   - shouldn't reference other fragments
  //   - should have atleast one leaf
  //   - all scalars should have exports directive
  //   - names in export directive should be uniq
  //   - should be used in @resolveWith
  //   - no field alliases
  // operations:
  //   - only query and mutation no subscription
  //   - should have name
  //   - shoud have uniq names
  //   - should have @send(to:)
  //   - valid against external schema
  //   - should have exactly one "leaf" which is "{...CLIENT_SELECTION}" or scalar
  //   - don't reference other fragments
  //   - should be used in @resolveWith
  //   - no field alliases
}
