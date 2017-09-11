declare var describe, test;

import { testJoin } from './testUtils';

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
