import { GraphQLClient } from 'graphql-request';
import {
  TypeDefinitionNode,
  GraphQLSchema,
  IntrospectionQuery,

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
  SplittedAST,

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
    // TODO: headers white listing from request
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
  joinAST: SplittedAST,
  remoteSchemas: { [name: string]: GraphQLSchema },
  prefixMap: { [name: string]: string }
): Promise<GraphQLSchema> {
  const remoteTypeNodes = getRemoteTypeNodes();

  const typeToSourceAPI = {};
  for (const [source, types] of Object.entries(remoteTypeNodes)) {
    for (const {name: {value}} of types) {
      typeToSourceAPI[value] = source;
    }
  }

  const schema = buildSchemaFromSDL();
  for (const type of Object.values(schema.getTypeMap())) {
    const sourceAPI = typeToSourceAPI[type.name];
    if (sourceAPI) {
      const prefix = prefixMap[sourceAPI];
      const originName = prefix ? type.name : type.name.replace(prefix, '');

      type['sourceAPI'] = sourceAPI;
      type['originType'] = remoteSchemas[sourceAPI].getType(originName);
    }
  }
  return schema;

  function buildSchemaFromSDL() {
    const mergedSDL = makeASTDocument([
      ...joinAST.types,
      ...flatten(Object.values(remoteTypeNodes)),
    ]);

    let schema = buildASTSchema(mergedSDL);

    const extensionsAST = makeASTDocument(joinAST.typeExtensions);
    schema = extendSchema(schema, extensionsAST);

    for (const type of Object.values(schema.getTypeMap())) {
      if (!isBuiltinType(type.name)) {
        stubType(type);
      }
    }

    return schema;
  }

  function getRemoteTypeNodes(): { [name: string]: TypeDefinitionNode[] } {
    const remoteTypeNodes = mapValues(
      remoteSchemas,
      (schema, name) => schemaToASTTypes(schema, name)
    );

    for (const [name, prefix] of Object.entries(prefixMap)) {
      const types = remoteTypeNodes[name];
      if (types === undefined) {
        throw new Error(`unknown "${name}" name in prefixMap`)
      }
      for (const type of types) {
        addPrefixToTypeNode(prefix, type);
      }
    }

    return remoteTypeNodes;
  }
}

async function main() {
  const joinAST = splitAST(readGraphQLFile('./join.graphql'));
  const prefixMap = {};

  const remoteSchemas = {};
  for (const [name, {prefix, ...settings}] of Object.entries(endpoints)) {
    //FIXME: add error prefix
    remoteSchemas[name] = await getRemoteSchema(settings);
    if (prefix) {
      prefixMap[name] = prefix;
    }
  }

  // FIXME: validate that all directive known and locations are correct
  // FIXME: error if specified directives join AST 
  //validateDirectives(joinAST);

  const schema = await buildJoinSchema(joinAST, remoteSchemas, prefixMap);
  // FIXME: check for subscription and error as not supported
  console.log(printSchema(schema));

  const operations = keyBy(joinAST.operations, operation => {
    if (!operation.name) {
      throw new Error('Does not support anonymous operation.');
    }
    return operation.name.value;
  });

  const fragments = keyBy(joinAST.fragments, fragment => fragment.name.value);
  // TODO: check that mutation is executed in sequence
}

main().catch(e => {
  console.log(e);
});
