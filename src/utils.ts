import {
  keyBy,
  flatten,
  cloneDeep,
  isInteger,
  set as pathSet
} from 'lodash';

import {
  Kind,
  ASTNode,
  NameNode,
  ValueNode,
  DocumentNode,
  SelectionNode,
  DefinitionNode,
  SelectionSetNode,
  TypeDefinitionNode,
  SchemaDefinitionNode,
  FragmentDefinitionNode,
  DirectiveDefinitionNode,
  OperationDefinitionNode,
  TypeExtensionDefinitionNode,

  GraphQLSchema,
  GraphQLNamedType,
  GraphQLScalarType,
  GraphQLObjectType,
  GraphQLTypeResolver,
  GraphQLFieldResolver,
  ExecutionResult,

  isAbstractType,
  getVisitFn,
} from 'graphql';

type SchemaResolvers = {
  resolve?: GraphQLFieldResolver<any, any>;
  resolveType?: GraphQLTypeResolver<any,any>;
};

export function stubSchema(
  schema: GraphQLSchema,
  resolvers: SchemaResolvers = {}
): void {
  for (const type of Object.values(schema.getTypeMap())) {
    if (!isBuiltinType(type.name)) {
      stubType(type, resolvers);
    }
  }
}

function stubType(
  type: GraphQLNamedType,
  resolvers: SchemaResolvers = {}
): void {
  if (type instanceof GraphQLScalarType) {
    type.serialize = (value => value);
    type.parseLiteral = astToJSON;
    type.parseValue = astToJSON;
  } else if (isAbstractType(type)) {
    type.resolveType = resolvers.resolveType || (obj => obj.__typename);
  } else if (type instanceof GraphQLObjectType) {
    for (const field of Object.values(type.getFields())) {
      field.resolve = resolvers.resolve || undefined;
    }
  }
}

// TODO: Merge into graphql-js
function astToJSON(ast: ValueNode): any {
  switch (ast.kind) {
    case Kind.NULL:
      return null;
    case Kind.INT:
      return parseInt(ast.value, 10);
    case Kind.FLOAT:
      return parseFloat(ast.value);
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.LIST:
      return ast.values.map(astToJSON);
    case Kind.OBJECT:
      return ast.fields.reduce((object, {name, value}) => {
        object[name.value] = astToJSON(value);
        return object;
      }, {});
    default:
      throw Error('Unexpected value');
  }
}

export function jsonToAST(json: any): ValueNode {
  switch (typeof json) {
    case 'string':
      return { kind: Kind.STRING, value: json };
    case 'boolean':
      return { kind: Kind.BOOLEAN, value: json };
    case 'number':
      if (isInteger(json)) {
        return { kind: Kind.INT, value: json };
      } else {
        return { kind: Kind.FLOAT, value: json };
      }
    case 'object':
      if (json === null) {
        return { kind: Kind.NULL };
      } else if (Array.isArray(json)) {
        return { kind: Kind.LIST, values: json.map(jsonToAST) };
      } else {
        return {
          kind: Kind.OBJECT,
          fields: Object.entries(json).map(([name, value]) => ({
            kind: Kind.OBJECT_FIELD,
            name: nameNode(name),
            value: jsonToAST(value),
          })),
        };
      }
    default:
      throw Error('Unexpected value');
  }
}

// TODO: Merge into graphql-js
export function isBuiltinType(name: string) {
  return name.startsWith('__') || [
    'String', 'Int', 'ID', 'Float', 'Boolean'
  ].indexOf(name) !== -1;
}

// TODO: move to graphql-js
export type SplittedAST = {
  schemas: SchemaDefinitionNode[],
  types: TypeDefinitionNode[],
  typeExtensions: TypeExtensionDefinitionNode[],
  directives: DirectiveDefinitionNode[],
  operations: OperationDefinitionNode[],
  fragments: FragmentDefinitionNode[],
};

export function splitAST(
  documentAST: DocumentNode
): SplittedAST {
  const result: SplittedAST = {
    schemas: [],
    types: [],
    typeExtensions: [],
    directives: [],
    operations: [],
    fragments: [],
  };

  for (const node of documentAST.definitions) {
    switch (node.kind) {
      case Kind.SCHEMA_DEFINITION:
        result.schemas.push(node);
        break;
      case Kind.SCALAR_TYPE_DEFINITION:
      case Kind.ENUM_TYPE_DEFINITION:
      case Kind.OBJECT_TYPE_DEFINITION:
      case Kind.INTERFACE_TYPE_DEFINITION:
      case Kind.UNION_TYPE_DEFINITION:
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
        result.types.push(node);
        break;
      case Kind.TYPE_EXTENSION_DEFINITION:
        result.typeExtensions.push(node);
        break;
      case Kind.DIRECTIVE_DEFINITION:
        result.directives.push(node);
        break;
      case Kind.OPERATION_DEFINITION:
        result.operations.push(node);
        break;
      case Kind.FRAGMENT_DEFINITION:
        result.fragments.push(node);
        break;
    }
  }
  return result;
}

export function makeASTDocument(definitions: DefinitionNode[]): DocumentNode {
  return {
    kind: Kind.DOCUMENT,
    definitions,
  };
}

export function injectErrors(result: ExecutionResult): object | void {
  if (result.errors === undefined) {
    return result.data;
  }

  const globalErrors: Error[] = [];
  const data = result.data && cloneDeep(result.data);
  for (const errObj of (result.errors || [])) {
    const err = new Error(errObj.message);
    if (errObj.path) {
      // Recreate root value up to a place where original error was thrown
      pathSet(data, errObj.path, err);
    } else {
      globalErrors.push(err);
    }
  }

  if (globalErrors.length !== 0) {
    const message = globalErrors.map(err => err.message).join('\n');
    return new Error(message);
  }
  return data;
}

export function injectTypename(
  node: SelectionSetNode,
  alias?: string
): SelectionSetNode {
  // TODO: don't add duplicating __typename
  return selectionSetNode([
    ...node.selections,
    {
      kind: Kind.FIELD,
      name: nameNode('__typename'),
      alias: alias !== undefined ? nameNode(alias) : undefined,
    },
  ]);
}

export function nameNode(name: string): NameNode {
  return {
    kind: Kind.NAME,
    value: name,
  };
}

export function selectionSetNode(selections: SelectionNode[]) {
  return {
    kind: Kind.SELECTION_SET,
    selections,
  };
}

export function mergeSelectionSets(
  nodes: {selectionSet?: SelectionSetNode}[]
): SelectionSetNode | undefined {
  const sets = flatten(nodes
    .filter(node => node.selectionSet)
    .map(node => node.selectionSet!.selections)
  );

  return sets.length > 0 ? selectionSetNode(sets) : undefined;
}

export function visitWithResultPath(resultPath: string[], visitor) {
  return {
    enter(node) {
      addToPath(node);
      const fn = getVisitFn(visitor, node.kind, /* isLeaving */ false);
      if (fn) {
        const result = fn.apply(visitor, arguments);
        if (result !== undefined) {
          resultPath.pop();

          if (isNode(result)) {
            addToPath(node);
          }
        }
        return result;
      }
    },
    leave(node) {
      const fn = getVisitFn(visitor, node.kind, /* isLeaving */ true);
      let result;
      if (fn) {
        result = fn.apply(visitor, arguments);
      }

      if (node.kind === Kind.FIELD) {
        resultPath.pop();
      }
      return result;
    }
  };

  function addToPath(node: ASTNode) {
    if (node.kind === Kind.FIELD) {
      resultPath.push((node.alias || node.name).value);
    }
  }

  function isNode(maybeNode) {
    return maybeNode && typeof maybeNode.kind === 'string';
  }
}

export function extractByPath(obj: any, path: string[]) {
  let result = obj;
  for (let i = 0; i < path.length; ++i) {
    if (result == null || result instanceof Error) {
      return result;
    } else if (Array.isArray(result)) {
      const subpath = path.slice(i);
      return result.map(
        item => extractByPath(item, subpath)
      );
    } else {
      result = result[path[i]];
    }
  }
  return result;
}

export function keyByNameNodes<T extends { name?: NameNode }>(
  nodes: T[]
): { [name: string]: T } {
  return keyBy(nodes, node => node.name!.value);
}

export function prefixAlias(alias: string): string {
  // Never clashes with field names since they can't have '___' in names
  return '___a_' + alias;
}

export function typeNameAlias(schemaName: string): string {
  return '___t_' + schemaName;
}

export function prefixTopLevelFields(
  selectionSet: SelectionSetNode,
  prefix: string
): SelectionSetNode {
  return selectionSetNode(selectionSet.selections.map(selection => {
    switch (selection.kind) {
      case Kind.FIELD:
        const resultName = (selection.alias || selection.name).value
        return {
          ...selection,
          alias: nameNode(prefix + resultName),
        };
      case Kind.INLINE_FRAGMENT:
        return {
          ...selection,
          selectionSet: prefixTopLevelFields(selection.selectionSet, prefix),
        };
      case Kind.FRAGMENT_SPREAD:
        throw new Error('Unexpected fragment spread');
    }
  }));
}
