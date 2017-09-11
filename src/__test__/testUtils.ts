declare var expect;

import {
  Source,
  DocumentNode,
  GraphQLError,
  GraphQLSchema,
  GraphQLFieldResolver,
  GraphQLResolveInfo,
  ExecutionResult,

  graphql,
  parse,
  print,
  buildSchema,
  printSchema,
  formatError,
} from 'graphql';
import * as _ from 'lodash';

import { joinSchemas, ProxyContext } from '../index';
import { stubSchema } from '../utils';

expect.addSnapshotSerializer({
  print(val) {
    return typeof val === 'string' ?
      val.trim() :
      JSON.stringify(val, null, 2);
  },
  test(val) {
    return true;
  },
});

function fakeFieldResolver(schemaName: string): GraphQLFieldResolver<any,any> {
  return (
    _1, _2, _3,
    {fieldName, parentType}: GraphQLResolveInfo
  ) => {
    return `${schemaName}::${parentType.name}::${fieldName}`;
  }
}

function makeProxy(schemaName: string, schema: GraphQLSchema) {
  return (queryAST: DocumentNode) => {
    const query = print(queryAST);
    expect(query).toMatchSnapshot();
    return graphql({
      schema,
      source: query,
      fieldResolver: fakeFieldResolver(schemaName),
    });
  };
}

type TestSchema = string;
type TestSchemasMap = { [name: string]: TestSchema };
export function testJoin(testSchemas: TestSchemasMap, joinSDL: string) {
  const remoteSchemas = _.mapValues(testSchemas, (sdl, name) => {
    const schema = buildSchema(new Source(sdl, name));
    stubSchema(schema);
    return { schema };
  });

  const joinAST = parse(new Source(joinSDL, 'Join SDL'));
  const schema = joinSchemas(joinAST, remoteSchemas);

  expect(schema).toBeInstanceOf(GraphQLSchema);
  expect(printSchema(schema)).toMatchSnapshot();
  return async (
    query: string,
    results?: { [schemaName: string]: ExecutionResult }
  ) => {
    const proxyFns = _.mapValues(remoteSchemas, ({schema}, name) => {
      if (results && results[name]) {
        return (() => Promise.resolve(results[name]));
      }
      return makeProxy(name, schema)
    });

    const result = await graphql({
      schema,
      source: new Source(query, 'ClientQuery'),
      contextValue: new ProxyContext(proxyFns),
    });
    expect([
      query,
      resultToJSON(result),
    ]).toMatchSnapshot();
  };
}

function resultToJSON(result) {
  return {
    ...result,
    errors: (result.errors || []).map(formatError),
  };
}

