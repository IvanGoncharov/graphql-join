import { readFileSync } from 'fs';
import { flatten } from 'lodash';

import {
  Kind,
  Source,
  DocumentNode,
  DefinitionNode,

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

export function addPrefixToIntrospection(
  introspection: IntrospectionQuery,
  prefix?: String
) {
  if (prefix == null) {
    return;
  }

  function prefixType(
    obj: IntrospectionNamedTypeRef | IntrospectionType | undefined
  ) {
    if (obj == null || isBuiltinType(obj.name)) {
      return;
    }
    obj.name = prefix + obj.name;
  }

  function prefixWrappedType(obj: IntrospectionTypeRef) {
    if (obj.kind === 'LIST' || obj.kind === 'NON_NULL') {
      if (obj['ofType']) {
        prefixWrappedType(obj['ofType']);
      }
    } else {
      prefixType(obj as IntrospectionNamedTypeRef);
    }
  }

  function prefixTypeRef(container: {type: IntrospectionTypeRef}) {
    prefixWrappedType(container.type);
  }

  const { __schema: schema } = introspection;
  prefixType(schema.queryType);
  prefixType(schema.mutationType);
  prefixType(schema.subscriptionType);
  schema.directives.forEach(
    directive => directive.args.forEach(prefixTypeRef)
  );
  schema.types.forEach(type => {
    prefixType(type);
    (Object.values(type['fields'] || {})).forEach(field => {
      prefixTypeRef(field);
      field.args.forEach(prefixTypeRef);
    });
    (type['interfaces'] || []).forEach(prefixType);
    (type['possibleTypes'] || []).forEach(prefixType);
    (Object.values(type['inputFields'] || {})).forEach(prefixTypeRef);
  });
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

export function schemaToASTTypes(schema: GraphQLSchema): DefinitionNode[] {
  const ast = parse(printSchema(schema));
  const astNodeMap = splitAST(ast);
  delete astNodeMap[Kind.SCHEMA_DEFINITION];
  return flatten(Object.values({
    ...splitAST(ast),
    [Kind.SCHEMA_DEFINITION]: [],
    [Kind.DIRECTIVE_DEFINITION]: [],
  }));
}

export function readGraphQLFile(path: string): DocumentNode {
  const data = readFileSync(path, 'utf-8');
  return parse(new Source(data, path));
}
