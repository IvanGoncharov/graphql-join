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
  getDirectiveValues,
} from 'graphql';

import {
  keyBy,
  flatten,
  mapValues,
} from 'lodash';

import {
  validateDirectives,
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

type Endpoint = {
  prefix?: string
  url: string
  headers?: {[name: string]: string}
}

const endpoints: { [name: string]: Endpoint } = {
  graphcool: {
    url: 'http://localhost:9002/graphql'
  },
  yelp: {
    prefix: 'Yelp_',
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
  remoteSchemas: { [name: string]: GraphQLSchema },
  prefixMap: { [name: string]: string }
): Promise<GraphQLSchema> {
  validateDirectives(joinAST);
  // FIXME: validate that all directive known and locations are correct
  const joinASTDefinitions = splitAST(joinAST);
  // FIXME: error if specified directives join AST 
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
}

async function main() {
  const joinAST = readGraphQLFile('./join.graphql');
  const prefixMap = {};

  const remoteSchemas = {};
  for (const [name, {prefix, ...settings}] of Object.entries(endpoints)) {
    //FIXME: add error prefix
    remoteSchemas[name] = await getRemoteSchema(settings);
    if (prefix) {
      prefixMap[name] = prefix;
    }
  }

  const schema = await buildJoinSchema(joinAST, remoteSchemas, prefixMap);
  console.log(printSchema(schema));
}

main().catch(e => {
  console.log(e);
});
