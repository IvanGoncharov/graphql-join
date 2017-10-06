import {
  Kind,
  ASTNode,
  NameNode,
  VariableNode,
  NamedTypeNode,
  SelectionSetNode,
  OperationTypeNode,
  FragmentSpreadNode,

  DocumentNode,
  VariableDefinitionNode,

  ExecutionResult,
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLError,

  isAbstractType,
  getNamedType,

  TypeInfo,
  visit,
  visitWithTypeInfo,
} from 'graphql';

import {
  get as pathGet,
  mapValues,
  flatten,
} from 'lodash';

import * as DataLoader from 'dataloader';

import {
  injectErrors,
  injectTypename,
  makeASTDocument,
  extractByPath,
  nameNode,

  mergeSelectionSets,

  prefixAlias,
  typeNameAlias,
  selectionSetNode,
  makeInlineVariablesVisitor,
  prefixTopLevelFields,
} from './utils';
import { GraphQLJoinSchema, ResolveWithArgs } from './GraphQLJoinSchema';

export type ProxyCall = {
  sendTo: string;
  operationType: OperationTypeNode;
  makeSelectionSet: (clientSelection?: SelectionSetNode) => SelectionSetNode;
  resultPath: string[];
};

export type SchemaProxyFn =
  (query: DocumentNode, variableValues?: object) => Promise<ExecutionResult>;
export type SchemaProxyFnMap = { [schemaName: string]: SchemaProxyFn };
type BatchLoader = DataLoader<SelectionSetNode, ExecutionResult>;

export class ProxyContext {
  _proxyLoaders: {
    query: { [schemaName: string]: BatchLoader },
    mutation: { [schemaName: string]: BatchLoader }
  }
  constructor(
    public joinSchema: GraphQLJoinSchema,
    proxyFns: SchemaProxyFnMap
  ) {
    this._proxyLoaders = {
      query: mapValues(proxyFns, fn => makeBatchLoader('query', fn)),
      mutation: mapValues(proxyFns, fn => makeBatchLoader('mutation', fn)),
    }
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
    const loader = this._proxyLoaders[call.operationType][call.sendTo];
    const result = await loader.load(
      call.makeSelectionSet(
        this._clientSelection(call, info)
      )
    );
    const data = injectErrors(result);
    return extractByPath(data, call.resultPath);
  }

  _clientSelection(
    call: ProxyCall,
    info: GraphQLResolveInfo
  ): SelectionSetNode {
    const sendTo = call.sendTo;
    const { joinToOrigin } = this.joinSchema;

    const selection = mergeSelectionSets(info.fieldNodes);
    const typeInfo = new TypeInfo(info.schema);
    const rootType = getNamedType(info.returnType);
    typeInfo['_typeStack'].push(rootType);

    return visit(selection, visitWithTypeInfo(typeInfo, {
      ...makeInlineVariablesVisitor(info.variableValues),
      [Kind.NAME]: (node: NameNode, key: string) => {
        if (key === 'alias') {
          return nameNode(prefixAlias(node.value));
        }
      },
      [Kind.NAMED_TYPE]: (ref: NamedTypeNode) => {
        const typeName = ref.name.value;
        const originName = (joinToOrigin[typeName] || {})[sendTo];
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
        leave: (node: SelectionSetNode, _, parent?: ASTNode) => {
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

          if ((!parent || parent.kind === Kind.FIELD) && isAbstractType(type)) {
            return injectTypename(node, typeNameAlias(sendTo));
          }

          // FIXME: recursive remove empty selection
          if (node.selections.length === 0) {
            return injectTypename(node);
          }
          return node;
        }
      },
    }));
  }
}


function makeBatchLoader(
  operationType: OperationTypeNode,
  proxyFn: SchemaProxyFn
): BatchLoader {
  return new DataLoader(async (selections: SelectionSetNode[]) => {
    if (selections.length === 1) {
      return [ await proxyOperation(selections[0]) ];
    }

    const selectionsSet = selectionSetNode(flatten(
      selections.map((selection, index) =>
        prefixTopLevelFields(selection, `_${index}_`).selections
      )
    ));

    const batchResult = await proxyOperation(selectionsSet);
    const results = selections.map(() => ({
      data: {} as object,
      errors: [] as GraphQLError[]
    }));

    for (const [alias, value] of Object.entries(batchResult.data || {})) {
      const {index, key} = splitIndexAndKey(alias);
      results[index]!.data![key] = value;
    }
    for (const error of (batchResult.errors || [])) {
      const path = error.path;
      if (path && path.length > 0) {
        const {index, key} = splitIndexAndKey(path[0] as string);
        results[index]!.errors!.push(new GraphQLError(
          error.message,
          error.nodes,
          error.source,
          error.positions,
          [key, ...path.slice(1)],
          error.originalError
        ));
      }
      else {
        for (const result of results) {
          result.errors.push(error)
        }
      }
    }

    return results;
  });

  function proxyOperation(selectionSet: SelectionSetNode) {
    return proxyFn(
      makeASTDocument([{
        kind: Kind.OPERATION_DEFINITION,
        operation: operationType,
        selectionSet,
      }])
    );
  }

  function splitIndexAndKey(alias: string) {
    const [_, indexStr, key] = alias.split('_', 3);
    return {
      index: parseInt(indexStr),
      key
    };
  }
}

