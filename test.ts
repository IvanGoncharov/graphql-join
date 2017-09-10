import {
  Source,
  DocumentNode,
  GraphQLSchema,
  GraphQLFieldResolver,
  GraphQLResolveInfo,

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
  ): any {
    return `${schemaName}::${parentType.name}::${fieldName}`;
  }
}

function makeProxy(schemaName: string, schema: GraphQLSchema) {
  return async (queryAST: DocumentNode) => {
    const query = print(queryAST);
    expect(query).toMatchSnapshot();
    debugger;
    const result = await graphql({
      schema,
      source: query,
      fieldResolver: fakeFieldResolver(schemaName),
    });
    return result;
  };
}

type TestSchema = string;
type TestSchemasMap = { [name: string]: TestSchema };
type QueryExecute = (query: string) => Promise<void>;
function testJoin(testSchemas: TestSchemasMap, joinSDL: string): QueryExecute {
  const remoteSchemas = _.mapValues(testSchemas, (sdl, name) => {
    const schema = buildSchema(new Source(sdl, name));
    stubSchema(schema);
    return {
      schema,
      proxy: makeProxy(name, schema),
    };
  });

  const joinAST = parse(new Source(joinSDL, 'Join SDL'));
  const schema = joinSchemas(joinAST, remoteSchemas);

  expect(schema).toBeInstanceOf(GraphQLSchema);
  expect(printSchema(schema)).toMatchSnapshot();
  return async (query: string) => {
    const result = await graphql({
      schema,
      source: new Source(query, 'ClientQuery'),
      contextValue: new ProxyContext(remoteSchemas),
    });
    const jsonResult = {
      ...result,
      errors: (result.errors || []).map(formatError),
    };
    expect([
      query,
      jsonResult,
    ]).toMatchSnapshot();
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
        type Test2Query { bar: String }
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
    //await execute('{ foo }');
    await execute('{ bar { baz } }');
    //await execute('{ foo bar { baz } }');
  });

});
