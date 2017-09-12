declare var describe, test;

import { testJoin } from './testUtils';

describe('type system', () => {

  test('arrays in response type', async () => {
    const execute = testJoin({
      test: `
        type Query { foo: [[Bar]] }
        type Bar { bar: String }
      `,
    }, `
      type Query {
        foo: [[String]] @resolveWith(query: "foo")
      }

      query foo @send(to: "test") {
        foo {
          bar
        }
      }
    `);

    await execute('{ foo }', { test: {
      data: {
        foo: [
          [{bar: 'a'}, {bar: 'b'}],
          [{bar: 'c'}]
        ],
      }
    }});
  });

  test('arrays of objects with arrays in response type', async () => {
    const execute = testJoin({
      test: `
        type Query { foo: [Bar] }
        type Bar { bar: [Baz] }
        type Baz { baz: String }
      `,
    }, `
      type Query {
        foo: [[String]] @resolveWith(query: "foo")
      }

      query foo @send(to: "test") {
        foo {
          bar {
            baz
          }
        }
      }
    `);

    await execute('{ foo }', { test: {
      data: {
        foo: [
          {
            bar: [{baz: 'a'}, {baz: 'b'}],
          },
          {
            bar: [{baz: 'c'}]
          },
        ],
      }
    }});
  });
});
