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

import { joinSchemas, ProxyContext } from './index';
import { stubSchema } from './utils';

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
function testJoin(testSchemas: TestSchemasMap, joinSDL: string) {
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

describe('custom Query type', () => {

  test('one schema', async () => {
    const execute = testJoin({
      test: 'type Query { foo: String, bar:String }',
    }, `
      type Query {
        foo: String @resolveWith(query: "foo")
      }
      query foo @send(to: "test") { foo }
    `);
    await execute('{ foo }');
  });

  test('two schemas', async () => {
    const execute = testJoin({
      test1: 'type Query { foo: String, bar: String }',
      test2: 'type Query { baz: String }',
    }, `
      type Query {
        foo: String @resolveWith(query: "foo")
        baz: String @resolveWith(query: "baz")
      }
      query foo @send(to: "test1") { foo }
      query baz @send(to: "test2") { baz }
    `);
    await execute('{ foo }');
    await execute('{ baz }');
    await execute('{ foo baz }');
  });

});

describe('grafting tests', () => {

  test('extend Query type', async () => {
    const execute = testJoin({
      test1: `type Query { foo: String }`,
      test2: `
        schema { query: Test2Query }
        type Test2Query { bar: Bar }
        type Bar { baz: String }
      `
    },`
      schema {
        query: Query # test1 Query
      }
      extend type Query {
        bar: Bar @resolveWith(query: "bar")
      }
      query bar @send(to: "test2") {
        bar { ...CLIENT_SELECTION }
      }
    `);
    await execute('{ foo }');
    await execute('{ bar { baz } }');
    await execute('{ foo bar { baz } }');
  });

});

describe('errors tests', () => {

  test('extend Query type', async () => {
    const execute = testJoin({
      test: `
        type Query { foo: Bar }
        type Bar { bar: String }
      `,
    },'schema { query: Query }');

    await execute('{ foo { bar } }', { test: {
      errors: [ new GraphQLError('global error') ],
    }});
    await execute('{ foo { bar } }', { test: {
      errors: [
        new GraphQLError('first global error'),
        new GraphQLError('second global error')
      ],
    }});
    await execute('{ foo { bar } }', {
      test: {
        data { foo: { bar: null } },
        errors: [
          new GraphQLError('error with path', null, null, null, ['foo', 'bar'])
        ],
      }
    });
  });

});
