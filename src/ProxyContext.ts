import {
  Kind,
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

  isAbstractType,
  getNamedType,

  TypeInfo,
  visit,
  visitWithTypeInfo,
} from 'graphql';

import {
  get as pathGet,
} from 'lodash';

import {
  injectErrors,
  injectTypename,
  makeASTDocument,
  extractByPath,
  nameNode,

  mergeSelectionSets,

  prefixAlias,
  typeNameAlias,
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
    const { joinToOrigin } = this.joinSchema;
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
