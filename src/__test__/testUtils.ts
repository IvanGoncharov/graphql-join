declare var expect;

import {
  Source,
  DocumentNode,
  GraphQLError,
  GraphQLSchema,
  GraphQLFieldResolver,
  GraphQLResolveInfo,
  ExecutionArgs,
  ExecutionResult,

  graphql,
  parse,
  validate,
  execute,
  print,
  buildSchema,
  printSchema,
  formatError,
  specifiedRules,
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
    _1, args: object, _3,
    {fieldName, parentType}: GraphQLResolveInfo
  ) => {
    let result = `${schemaName}::${parentType.name}::${fieldName}`;
    if (Object.keys(args).length !== 0) {
      result += `;args=${JSON.stringify(args)}`
    }
    return result;
  }
}

function makeProxy(schemaName: string, schema: GraphQLSchema) {
  return (queryAST: DocumentNode) => {
    const query = print(queryAST);
    expect(query).toMatchSnapshot();
    // FIXME: Should use executeQuery but blocked by
    // https://github.com/facebook/jest/issues/3917
    return graphql({
      schema,
      source: new Source(query, 'Send to ' + schemaName),
      fieldResolver: fakeFieldResolver(schemaName),
    });
  };
}

type TestSchema = string | { sdl: string, prefix?: string };
type TestSchemasMap = { [name: string]: TestSchema };
export function testJoin(testSchemas: TestSchemasMap, joinSDL: string) {
  const remoteSchemas = _.mapValues(testSchemas, (schemaSource, name) => {
    if (typeof schemaSource === 'string') {
      schemaSource = { sdl: schemaSource };
    }
    const { prefix, sdl } = schemaSource;
    const schema = buildSchema(new Source(sdl, name));
    stubSchema(schema);
    return { schema , prefix};
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

    const result = await executeQuery({
      schema,
      document: parse(new Source(query, 'ClientQuery')),
      contextValue: new ProxyContext(proxyFns),
    });

    expect([
      query,
      resultToJSON(result),
    ]).toMatchSnapshot();
  };
}

function executeQuery(args: ExecutionArgs) {
  const validationErrors = validate(args.schema, args.document, specifiedRules);
  expect(validationErrors.join('\n')).toBe('');
  return execute(args);
}

function resultToJSON(result) {
  return {
    ...result,
    errors: (result.errors || []).map(formatError),
  };
}

