import { readFileSync } from 'fs';
import { flatten } from 'lodash';

import {
  Kind,
  Source,
  NameNode,
  TypeNode,
  DocumentNode,
  DefinitionNode,
  TypeDefinitionNode,
  FieldDefinitionNode,

  GraphQLSchema,
  GraphQLNamedType,
  GraphQLScalarType,

  IntrospectionQuery,
  IntrospectionType,
  IntrospectionTypeRef,
  IntrospectionNamedTypeRef,

  parse,
  printSchema,
  isAbstractType,
} from 'graphql';

export function stubType(type: GraphQLNamedType) {
  if (type instanceof GraphQLScalarType) {
    type.serialize = (value => value);
    type.parseLiteral = astToJSON;
    type.parseValue = astToJSON;
  }
  else if (isAbstractType(type)) {
    type.resolveType = (obj => obj.__typename);
  }
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

export function addPrefixToTypeNode(
  prefix: String,
  type: TypeDefinitionNode
) {
  prefixName(type);
  switch (type.kind) {
    case Kind.OBJECT_TYPE_DEFINITION:
      (type.interfaces || []).forEach(prefixName);
      (type.fields || []).forEach(prefixField);
      break;
    case Kind.INTERFACE_TYPE_DEFINITION:
      (type.fields || []).forEach(prefixField);
      break;
    case Kind.UNION_TYPE_DEFINITION:
      (type.types || []).forEach(prefixName);
      break;
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
      (type.fields || []).forEach(prefixTypeName);
      break;
  }

  function prefixName({name}: {name: NameNode}) {
    if (!isBuiltinType(name.value)) {
      name.value = prefix + name.value;
    }
  }
  function prefixTypeName({type}: {type: TypeNode}) {
    if (type.kind === Kind.NAMED_TYPE) {
      prefixName(type)
    } else {
      prefixTypeName(type);
    }
  }
  function prefixField(field: FieldDefinitionNode) {
    prefixTypeName(field);
    (field.arguments || []).forEach(prefixTypeName);
  }
}

export function splitAST(
  documentAST: DocumentNode
): { [name: string]: DefinitionNode[] } {
  const result = {};
  for (const node of documentAST.definitions) {
    result[node.kind] = result[node.kind] || [];
    result[node.kind].push(node);
  }
  return result;
}

export function makeASTDocument(definitions: DefinitionNode[]): DocumentNode {
  return {
    kind: Kind.DOCUMENT,
    definitions,
  };
}

export function schemaToASTTypes(schema: GraphQLSchema): TypeDefinitionNode[] {
  const ast = parse(printSchema(schema));
  const types = flatten(Object.values({
    ...splitAST(ast),
    [Kind.SCHEMA_DEFINITION]: [],
    [Kind.DIRECTIVE_DEFINITION]: [],
  })) as TypeDefinitionNode[];

  return types.filter(type => !isBuiltinType(type.name.value));
}

export function readGraphQLFile(path: string): DocumentNode {
  const data = readFileSync(path, 'utf-8');
  return parse(new Source(data, path));
}
