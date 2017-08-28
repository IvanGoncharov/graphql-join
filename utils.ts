import { readFileSync } from 'fs';

import {
  Kind,
  Source,
  NameNode,
  TypeNode,
  DocumentNode,
  DefinitionNode,
  TypeDefinitionNode,
  FieldDefinitionNode,
  SchemaDefinitionNode,
  FragmentDefinitionNode,
  DirectiveDefinitionNode,
  OperationDefinitionNode,
  TypeExtensionDefinitionNode,

  GraphQLSchema,
  GraphQLNamedType,
  GraphQLScalarType,
  GraphQLObjectType,

  parse,
  visit,
  printSchema,
  isAbstractType,
} from 'graphql';

import { RemoteSchema } from './types';

export function stubType(type: GraphQLNamedType) {
  if (type instanceof GraphQLScalarType) {
    type.serialize = (value => value);
    type.parseLiteral = astToJSON;
    type.parseValue = astToJSON;
  } else if (isAbstractType(type)) {
    type.resolveType = (obj => obj.__typename);
  } else if (type instanceof GraphQLObjectType) {
    for (const field of Object.values(type.getFields())) {
      field.resolve = stubFieldResolver;
    }
  }
}

// proxy value or Error instance injected by the proxy
function stubFieldResolver(source, _1, _2, info) {
  const key = info.path && info.path.key;
  return source && source[key];
}

// TODO: Merge into graphql-js
function astToJSON(ast) {
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
  }
}

// TODO: Merge into graphql-js
export function isBuiltinType(name: string) {
  return name.startsWith('__') || [
    'String', 'Int', 'ID', 'Float', 'Boolean'
  ].indexOf(name) !== -1;
}

function addPrefixToTypeNode(
  type: TypeDefinitionNode,
  prefix?: string
) {
  if (!prefix) {
    return type;
  }

  type.name = prefixName(type.name);
  return visit(type, {
    [Kind.NAMED_TYPE]: node => ({ ...node, name: prefixName(node.name) }),
  });

  function prefixName(node: NameNode): NameNode {
    const name = node.value;
    return isBuiltinType(name) ? node: { ...node, value: prefix + name };
  }
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

export function schemaToASTTypes(
  remoteSchema: RemoteSchema
): TypeDefinitionNode[] {
  const sdl = printSchema(remoteSchema.schema);
  const ast = parse(sdl, { noLocation: true });
  const types = splitAST(ast).types;
  return types
    .filter(type => !isBuiltinType(type.name.value))
    .map(type => addPrefixToTypeNode(type, remoteSchema.prefix));
}

export function readGraphQLFile(path: string): DocumentNode {
  const data = readFileSync(path, 'utf-8');
  return parse(new Source(data, path));
}
