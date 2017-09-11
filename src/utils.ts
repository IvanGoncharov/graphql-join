import { readFileSync } from 'fs';
import { cloneDeep, set as pathSet } from 'lodash';

import {
  Kind,
  Source,
  NameNode,
  TypeNode,
  DocumentNode,
  NamedTypeNode,
  DefinitionNode,
  TypeDefinitionNode,
  FieldDefinitionNode,
  SchemaDefinitionNode,
  FragmentDefinitionNode,
  DirectiveDefinitionNode,
  OperationDefinitionNode,
  TypeExtensionDefinitionNode,

  GraphQLError,
  GraphQLSchema,
  GraphQLField,
  GraphQLNamedType,
  GraphQLScalarType,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLFieldResolver,
  ExecutionResult,

  parse,
  visit,
  printSchema,
  isAbstractType,
  extendSchema,
  buildASTSchema,
} from 'graphql';

type StubFieldFn = (type: GraphQLNamedType, field: GraphQLField<any, any>) => void;
export function stubSchema(
  schema: GraphQLSchema,
  stubField?: StubFieldFn
): void {
  for (const type of Object.values(schema.getTypeMap())) {
    if (!isBuiltinType(type.name)) {
      stubType(type, stubField);
    }
  }
}

function stubType(
  type: GraphQLNamedType,
  stubField?: StubFieldFn
): void {
  if (type instanceof GraphQLScalarType) {
    type.serialize = (value => value);
    type.parseLiteral = astToJSON;
    type.parseValue = astToJSON;
  } else if (isAbstractType(type)) {
    type.resolveType = (obj => obj.__typename);
  } else if (type instanceof GraphQLObjectType) {
    for (const field of Object.values(type.getFields())) {
      field.resolve = undefined;
      if (stubField) {
        stubField(type, field);
      }
    }
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

// function jsonToAST(json: any) {
//   switch (typeof json) {
//     case 'string':
//       return { kind: Kind.STRING, value: json };
//     case 'boolean':
//       return { kind: Kind.BOOLEAN, value: json };
//     case 'number':
//       if (isInteger(json)) {
//         return { kind: Kind.INT, value: json };
//       } else {
//         return { kind: Kind.FLOAT, value: json };
//       }
//     case 'object':
//       if (json === null) {
//         return { kind: Kind.NULL };
//       } else if (Array.isArray(json)) {
//         return { kind: Kind.LIST, value: json.map(jsonToAST) };
//       } else {
//       }
//   }
// }

// TODO: Merge into graphql-js
export function isBuiltinType(name: string) {
  return name.startsWith('__') || [
    'String', 'Int', 'ID', 'Float', 'Boolean'
  ].indexOf(name) !== -1;
}

export function addPrefixToTypeNode(
  type: TypeDefinitionNode,
  prefix?: string
) {
  if (!prefix) {
    return type;
  }

  type.name = prefixName(type.name);
  return visitTypeReferences(
    type,
    node => ({ ...node, name: prefixName(node.name) })
  );

  function prefixName(node: NameNode): NameNode {
    const name = node.value;
    return isBuiltinType(name) ? node: { ...node, value: prefix + name };
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

export function getTypesWithDependencies(
  typesMap: { [typeName: string]: TypeDefinitionNode },
  requiredTypes: string[]
): string[] {
  const returnTypes = [ ...requiredTypes ];

  for (const typeName of returnTypes) {
    visitTypeReferences(typesMap[typeName], ref => {
      const refType = ref.name.value;
      if (!returnTypes.includes(refType) && !isBuiltinType(refType)) {
        returnTypes.push(refType);
      }
    });
  }
  return returnTypes;
}

export function getExternalTypeNames(definitions: SplittedAST): string[] {
  var seenTypes = {};
  markTypeRefs(definitions.schemas);
  markTypeRefs(definitions.types);
  markTypeRefs(definitions.typeExtensions);

  var ownTypes = (definitions.types || []).map(type => type.name.value);
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
  schema: GraphQLSchema
): TypeDefinitionNode[] {
  const sdl = printSchema(schema);
  const ast = parse(sdl, { noLocation: true });
  const types = splitAST(ast).types;
  return types.filter(type => !isBuiltinType(type.name.value));
}

export function readGraphQLFile(path: string): DocumentNode {
  const data = readFileSync(path, 'utf-8');
  return parse(new Source(data, path));
}

export function buildSchemaFromSDL(defs: SplittedAST) {
  const sdl = makeASTDocument([
    ...defs.schemas,
    ...defs.types,
  ]);

  let schema = buildASTSchema(sdl);

  const extensionsAST = makeASTDocument(defs.typeExtensions);
  return extendSchema(schema, extensionsAST);
}

export function injectErrors(result: ExecutionResult): object | void {
  if (result.errors == null) {
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
