import { GraphQLClient } from 'graphql-request';
import {
  DocumentNode,
  DefinitionNode,
  TypeDefinitionNode,
  SchemaDefinitionNode,
  FragmentDefinitionNode,
  OperationDefinitionNode,

  GraphQLSchema,
  IntrospectionQuery,

  Kind,
  printSchema,
  extendSchema,
  buildASTSchema,
  buildClientSchema,
  introspectionQuery,
  separateOperations,
} from 'graphql';

// TODO: add to typings
import { getDirectiveValues } from 'graphql/execution/values';

import {
  keyBy,
  flatten,
  mapValues,
} from 'lodash';

import {
  exportDirective,
  typePrefixDirective,
  resolveWithDirective,
} from './directives';

import {
  stubType,
  isBuiltinType,
  addPrefixToTypeNode,
  splitAST,
  makeASTDocument,
  schemaToASTTypes,
  readGraphQLFile,
} from './utils';

async function getRemoteSchema(settings): Promise<GraphQLSchema> {
  const { url, headers } = settings;
  const client = new GraphQLClient(url, { headers });
  const introspection = await client.request(introspectionQuery) as IntrospectionQuery;
  return buildClientSchema(introspection);
}

const endpoints = {
  graphcool: {
    url: 'http://localhost:9002/graphql'
  },
  yelp: {
    url: 'https://api.yelp.com/v3/graphql',
    headers: {
      'Authorization': 'Bearer ' + process.env.YELP_TOKEN
    }
  }
};

// function isolateOperations(
//   operations: OperationDefinitionNode[],
//   fragments: FragmentDefinitionNode[]
// ): { [name: string]: DocumentNode } {
//   const dummyUserSelection = {
//     kind: Kind.FRAGMENT_DEFINITION,
//     name: {
//       kind: Kind.Name,
//       value: 'USER_SELECTION',
//     }
//   } as FragmentDefinitionNode;
//
//   // Check that user didn't specify USER_SELECTION fragment
//   const document = makeASTDocument([
//     operations,
//     ...fragments,
//     // Dummy User Selection
//     dummyUserSelection,
//   ]);
//   return separateOperations(document);
// }

async function buildJoinSchema(
  joinAST: DocumentNode,
  remoteSchemas: { [name: string]: GraphQLSchema }
): Promise<GraphQLSchema> {
  // FIXME: validate that all directive known and locations are correct
  const joinASTDefinitions = splitAST(joinAST);
  // FIXME: error if specified directives join AST 
  const schemaNode = getSchemaNode();
  const operationDefs =
    joinASTDefinitions[Kind.FRAGMENT_DEFINITION] as OperationDefinitionNode[];
  const fragmentDefs =
    joinASTDefinitions[Kind.OPERATION_DEFINITION] as FragmentDefinitionNode[];

  const operations = keyBy(operationDefs, operation => {
    if (!operation.name) {
      throw new Error('Does not support anonymous operation.');
    }
    return operation.name.value;
  });
  const fragments = keyBy(fragmentDefs, fragment => fragment.name.value);
  const schema = buildSchemaFromSDL();
  for (let type of Object.values(schema.getTypeMap())) {
    if (isBuiltinType(type.name)) {
      continue;
    }
    stubType(type);
  }

  return schema;

  function buildSchemaFromSDL() {
    const joinSDLDefinitons = flatten(Object.values({
      ...joinASTDefinitions,
      [Kind.TYPE_EXTENSION_DEFINITION]: [],
      [Kind.OPERATION_DEFINITION]: [],
      [Kind.FRAGMENT_DEFINITION]: [],
    })) as TypeDefinitionNode[];
    //TODO: add remote types only if it used in join + it's dependencies to minimise clashes
    const mergedSDL = makeASTDocument([
      ...getRemoteTypeNodes(),
      ...joinSDLDefinitons,
    ]);
    let schema = buildASTSchema(mergedSDL);
    // TODO: check that mutation is executed in sequence
    // FIXME: check for subscription and error as not supported

    const extensionsAST = makeASTDocument(
      joinASTDefinitions[Kind.TYPE_EXTENSION_DEFINITION]
    );

    return extendSchema(schema, extensionsAST);
  }

  function getRemoteTypeNodes(): TypeDefinitionNode[] {
    const remoteTypeNodes = mapValues(remoteSchemas, schemaToASTTypes);
    const prefixMap = getDirectiveValues(typePrefixDirective, schemaNode)['map'];
    for (const [name, prefix] of Object.entries(prefixMap)) {
      const types = remoteTypeNodes[name];
      if (types === undefined) {
        throw new Error(`@typePrefix: unknown "${name}" name`)
      }
      for (const type of types) {
        addPrefixToTypeNode(prefix, type);
      }
    }
    //FIXME: detect name clashes, but not if types are identical
    return flatten(Object.values(remoteTypeNodes));
  }

  function getSchemaNode(): SchemaDefinitionNode {
    const schemaNode = joinASTDefinitions[Kind.SCHEMA_DEFINITION];
    if (schemaNode.length === 0) {
      throw new Error('Must provide schema definition');
    } else if(schemaNode.length !== 1) {
      throw new Error('Must provide only one schema definition.');
    }
    return schemaNode[0] as SchemaDefinitionNode;
  }
}

async function main() {
  const joinAST = readGraphQLFile('./join.graphql');

  const remoteSchemas = {};
  for (const [name, settings] of Object.entries(endpoints)) {
    //FIXME: add error prefix
    remoteSchemas[name] = await getRemoteSchema(settings);
  }

  const schema = await buildJoinSchema(joinAST, remoteSchemas);
  console.log(printSchema(schema));
}

main();
