import { testJoin } from './testUtils';

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
