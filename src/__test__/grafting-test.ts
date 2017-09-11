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
  test('recursive extend', async () => {
    const execute = testJoin({
      test1: `
        type Query { foo: Foo }
        type Foo { fooValue: String }
      `,
      test2: `
        type Query { bar: Bar }
        type Bar { barValue: String }
      `
    },`
      type Query {
        foo: Foo @resolveWith(query: "foo")
      }
      extend type Foo {
        bar: Bar @resolveWith(query: "bar")
      }
      extend type Bar {
        foo: Foo @resolveWith(query: "foo")
      }
      query foo @send(to: "test1") {
        foo { ...CLIENT_SELECTION }
      }
      query bar @send(to: "test2") {
        bar { ...CLIENT_SELECTION }
      }
    `);
    await execute('{ foo { fooValue } }');
    await execute(`
      {
        foo {
          fooValue
          bar {
            barValue
            foo {
              fooValue
              bar {
                barValue
              }
            }
          }
        }
      }
    `);

  });
});
