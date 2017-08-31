import { GraphQLClient } from 'graphql-request';
import {
  DocumentNode,
  TypeDefinitionNode,
  GraphQLSchema,
  GraphQLNamedType,
  GraphQLObjectType,
  IntrospectionQuery,

  printSchema,
  buildClientSchema,
  introspectionQuery,
} from 'graphql';

import {
  keyBy,
  flatten,
  fromPairs,
  mapValues,
} from 'lodash';

import {
  validateDirectives,
  getResolveWithValues,
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
  buildSchemaFromSDL,
} from './utils';

// GLOBAL TODO:
//   - check that mutation is executed in sequence

async function getRemoteSchema(settings): Promise<GraphQLSchema> {
  const { url, headers } = settings;
  const client = new GraphQLClient(url, { headers });
  const introspection = await client.request(introspectionQuery) as IntrospectionQuery;
  return buildClientSchema(introspection);
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

function buildJoinSchema(
  joinDefs: SplittedAST,
  remoteSchemas: RemoteSchemasMap,
): GraphQLSchema {
  const extTypeRefs = getExternalTypeNames(joinDefs);
  const remoteTypes = getRemoteTypes(remoteSchemas, extTypeRefs);
  const schema = buildSchemaFromSDL({
    ...joinDefs,
    types: [
      ...joinDefs.types,
      ...remoteTypes.map(type => type.ast),
    ],
  });

  for (const { ast, originTypes } of remoteTypes) {
    schema.getType(ast.name.value)['originTypes'] = originTypes;
  }
  return schema;
}

function getRemoteTypes(
  remoteSchemas: RemoteSchemasMap,
  extTypeRefs: string[]
) {
  const remoteTypes = [] as {ast: TypeDefinitionNode, originTypes: OriginTypes }[];
  for (const [api, {schema, prefix = ''}] of Object.entries(remoteSchemas)) {
    const typesMap = keyBy(schemaToASTTypes(schema), 'name.value');

    const typesToExtract = extTypeRefs
      .filter(name => name.startsWith(prefix))
      .map(name => name.replace(prefix, ''))
      .filter(name => typesMap[name]);

    const extractedTypes = getTypesWithDependencies(typesMap, typesToExtract);
    for (const typeName of extractedTypes) {
      // TODO: merge types with same name and definition
      remoteTypes.push({
        ast: addPrefixToTypeNode(typesMap[typeName], prefix),
        originTypes: [ schema.getType(typeName) ],
      });
    }
  }
  return remoteTypes;
}

function joinSchemas(
  joinAST: DocumentNode,
  remoteSchemas: RemoteSchemasMap,
): GraphQLSchema {
  const joinDefs = splitAST(joinAST);
  const schema = buildJoinSchema(joinDefs, remoteSchemas);
  console.log(printSchema(schema));

  const operations = keyBy(joinDefs.operations, 'name.value');
  const fragments = keyBy(joinDefs.fragments, 'name.value');
  for (const type of Object.values(schema.getTypeMap())) {
    if (isBuiltinType(type.name)) continue;

    stubType(type);

    if (type instanceof GraphQLObjectType) {
      for (const field of Object.values(type.getFields())) {
        const args = getResolveWithValues(field['astNode']);
        if (!args) continue;

        console.log(args);
      }
    }
  }

  return schema;
}

import * as express from 'express';
import * as graphqlHTTP from 'express-graphql';
async function main() {
  const joinAST = readGraphQLFile('./join.graphql');
  const remoteSchemas = await getRemoteSchemas();
  const joinSchema = joinSchemas(joinAST, remoteSchemas);

  const express = require('express');
  const graphqlHTTP = require('express-graphql');

  const app = express();

  app.use('/graphql', graphqlHTTP({
    schema: joinSchema,
    graphiql: true
  }));

  app.listen(4000);
  console.log('\n\nhttp://localhost:4000/graphql');
}

main().catch(e => {
  console.log(e);

function validation() {
  // TODO:
  // JOIN AST:
  //   - check for subscription in schema and `Subscription` type and error as not supported
  //   - validate that all directive known and locations are correct
  //   - no specified directives inside join AST
  //   - all references to remote types are unambiguous
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
});
