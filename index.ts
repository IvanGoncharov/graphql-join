import { GraphQLClient } from 'graphql-request';
import {
  TypeDefinitionNode,
  GraphQLSchema,
  GraphQLNamedType,
  IntrospectionQuery,

  printSchema,
  extendSchema,
  buildASTSchema,
  buildClientSchema,
  introspectionQuery,
  getDirectiveValues,
} from 'graphql';

import {
  keyBy,
  flatten,
  fromPairs,
  mapValues,
} from 'lodash';

import {
  validateDirectives,
  exportDirective,
  resolveWithDirective,
} from './directives';

import { RemoteSchemasMap } from './types';

import {
  SplittedAST,

  stubType,
  isBuiltinType,
  splitAST,
  makeASTDocument,
  schemaToASTTypes,
  readGraphQLFile,
  addPrefixToTypeNode,
  getExternalTypeNames,
  getTypesWithDependencies,
} from './utils';

// GLOBAL TODO:
//   - check that mutation is executed in sequence

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
};

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

type OriginTypes = GraphQLNamedType[];

async function buildJoinSchema(
  joinDefs: SplittedAST,
  remoteSchemas: RemoteSchemasMap,
): Promise<GraphQLSchema> {
  const remoteTypes = getRemoteTypes();
  const schema = buildSchemaFromSDL({
    ...joinDefs,
    types: [
      ...joinDefs.types,
      ...remoteTypes.map(type => type.ast),
    ],
  });

  for (const type of Object.values(schema.getTypeMap())) {
    const remoteType = remoteTypes[type.name];
    type['originTypes'] = remoteType && remoteType.originTypes;
  }
  return schema;

  function getRemoteTypes() {
    const remoteTypes = [] as {ast: TypeDefinitionNode, originTypes: OriginTypes }[];
    const requiredTypes = getExternalTypeNames(joinDefs);
    for (const [api, {schema, prefix}] of Object.entries(remoteSchemas)) {
      const typesMap = keyBy(schemaToASTTypes(schema), 'name.value');
      const extractedTypes = getTypesWithDependencies(typesMap, requiredTypes);
      for (const typeName of extractedTypes) {
        remoteTypes.push({
          ast: addPrefixToTypeNode(typesMap[typeName], prefix),
          originTypes: [ schema.getType(typeName) ],
        });
      }
    }
    return remoteTypes;
  }
}

function validation() {

  // TODO:
  // JOIN AST:
  //   - validate that all directive known and locations are correct
  //   - no specified directives inside join AST
  // fragments:
  //   - shoud have uniq names
  //   - shouldn't reference other fragments
  //   - should have atleast one leaf
  //   - all scalars should have exports directive
  //   - names in export directive should be uniq
  //   - should be used in @resolveWith
  // operations:
  //   - only query and mutation no subscription
  //   - should have name
  //   - shoud have uniq names
  //   - should have @send(to:)
  //   - valid against external schema
  //   - should have atleast one "leaf" which is exactly "{...USER_SELECTION}"
  //   - don't reference other fragments
  //   - should be used in @resolveWith
}

function buildSchemaFromSDL(defs: SplittedAST) {
  const sdl = makeASTDocument([
    ...defs.schemas,
    ...defs.types,
  ]);

  let schema = buildASTSchema(sdl);

  const extensionsAST = makeASTDocument(defs.typeExtensions);
  return extendSchema(schema, extensionsAST);
}

async function getRemoteSchemas(): Promise<RemoteSchemasMap> {
  const promises = Object.entries(endpoints).map(
    async ([name, endpoint]) => {
      const {prefix, ...settings} = endpoint;
      return [name, {
        prefix,
        schema: await getRemoteSchema(settings),
      }]
    }
  );
  return Promise.all(promises).then(pairs => fromPairs(pairs));
}

async function main() {
  const remoteSchemas = await getRemoteSchemas();
  const joinAST = readGraphQLFile('./join.graphql');
  const joinDefs = splitAST(joinAST);

  const schema = await buildJoinSchema(joinDefs, remoteSchemas);
  // FIXME: check for subscription and error as not supported
  console.log(printSchema(schema));

  const operations = keyBy(joinDefs.operations, operation => {
    if (!operation.name) {
      throw new Error('Does not support anonymous operation.');
    }
    return operation.name.value;
  });

  const fragments = keyBy(joinDefs.fragments, fragment => fragment.name.value);
  for (const type of Object.values(schema.getTypeMap())) {
    if (isBuiltinType(type.name)) {
      continue;
    }

    stubType(type);
  }
}

main().catch(e => {
  console.log(e);
});
