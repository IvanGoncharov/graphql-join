import { GraphQLClient } from 'graphql-request';
import {
  DocumentNode,
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

import {
  keyBy,
  flattenDeep,
} from 'lodash';

import {
  exportDirective,
  resolveWithDirective,
} from './directives';

import {
  stubType,
  isBuiltinType,
  addPrefixToIntrospection,
  splitAST,
  makeASTDocument,
  schemaToASTDefinitions,
  readGraphQLFile,
} from './utils';

async function getIntrospection(settings): Promise<IntrospectionQuery> {
  const { url, headers } = settings;
  const client = new GraphQLClient(url, { headers });
  return await client.request(introspectionQuery) as IntrospectionQuery;
}

const endpoints = {
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

async function getSchemasFromEndpoints(
): Promise<{ [name: string]: GraphQLSchema }> {
  const remoteSchemas = {};

  for (const [name, settings] of Object.entries(endpoints)) {
    const introspection = await getIntrospection(settings);
    try {
      buildClientSchema(introspection);
    } catch (e) {
      // FIXME: prefix
      throw e;
    }

    addPrefixToIntrospection(introspection, settings['prefix']);
    remoteSchemas[name] = buildClientSchema(introspection);
  }
  return remoteSchemas;
}

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
  remoteSchemas: GraphQLSchema[]
): Promise<GraphQLSchema> {
  const remoteDefinitionNodes = remoteSchemas.map(schemaToASTDefinitions);
  const joinASTDefinitions = splitAST(joinAST);
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
    const mergedSDL = makeASTDocument(flattenDeep([
      ...Object.values({
        ...joinASTDefinitions,
        [Kind.TYPE_EXTENSION_DEFINITION]: [],
        [Kind.OPERATION_DEFINITION]: [],
        [Kind.FRAGMENT_DEFINITION]: [],
      }),
      ...Object.values(remoteDefinitionNodes),
    ]));

    let schema = buildASTSchema(mergedSDL);
    // FIXME: check for subscription and error as not supported

    const extensionsAST = makeASTDocument(
      joinASTDefinitions[Kind.TYPE_EXTENSION_DEFINITION]
    );

    return extendSchema(schema, extensionsAST);
  }
}

async function main() {
  const joinAST = readGraphQLFile('./join.graphql');

  const remoteSchemas = await getSchemasFromEndpoints();
  const schema = await buildJoinSchema(joinAST, Object.values(remoteSchemas));
  console.log(printSchema(schema));
}

main();
