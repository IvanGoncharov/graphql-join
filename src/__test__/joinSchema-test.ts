import { testJoin } from './testUtils';

describe('joinSchema', () => {

  test('Proxy only types referenced inside join schema', async () => {
    const execute = testJoin(
      {
        test: `
          type TypeToIgnore { stub: String, stubSubtype: SubTypeToIgnore }
          type SubTypeToIgnore { baz: String }
          type TypeToProxy { foo: String, bar: SubTypeToProxy }
          type SubTypeToProxy { baz: String }
          type Query {
            typeToIgnore: TypeToIgnore
            typeToProxy: TypeToProxy
          }
        `,
      }, `
        type Query {
          typeToProxy: TypeToProxy @resolveWith(query: "typeToProxy")
        }
        query typeToProxy @send(to: "test") {
          typeToProxy {
            ...CLIENT_SELECTION
          }
        }
      `);

    await execute(`
      {
        typeToProxy {
          foo
          bar {
            baz
          }
        }
      }
    `);
  });

  test('Prefix remote types', async () => {
    const execute = testJoin(
      {
        test: {
          idl: `
            type Query { foo: BarOrBaz }
            union BarOrBaz = Bar | Baz
            type Bar { bar: String }
            type Baz { baz: String }
          `,
          prefix: 'PrEfIx_'
        },
      },
      'schema { query: PrEfIx_Query }'
    );

    await execute(
      `{
        foo {
          ... on PrEfIx_Bar { bar }
          ... on PrEfIx_Baz { baz }
        }
      }`,
      { test: { data: {
        foo: { ___t_test: 'Baz', baz: 'test::Baz::baz' }
      }}}
    );
  });

  test('Merge duplicate types', async () => {
    const execute = testJoin(
      {
        test1: `
          type Foo { foo: String }
          type Query { foo: Foo }
        `,
        test2: `
          type Foo { foo: String }
          type Query { foo: Foo }
        `,
      }, `
        type Query {
          proxyFoo1: Foo @resolveWith(query: "foo1")
          proxyFoo2: Foo @resolveWith(query: "foo2")
        }
        query foo1 @send(to: "test1") {
          foo {
            ...CLIENT_SELECTION
          }
        }
        query foo2 @send(to: "test2") {
          foo {
            ...CLIENT_SELECTION
          }
        }
      `
    );

    await execute(`
      {
        proxyFoo1 { foo }
        proxyFoo2 { foo }
      }
    `);
  });

  test('Merge duplicate abstract types', async () => {
    const idl = `
      type Query { foo: BarOrBaz }
      union BarOrBaz = Bar | Baz
      type Bar { bar: String }
      type Baz { baz: String }
    `;
    const execute = testJoin(
      {
        test1: idl,
        test2: idl,
      }, `
        type Query {
          proxyFoo1: BarOrBaz @resolveWith(query: "foo1")
          proxyFoo2: BarOrBaz @resolveWith(query: "foo2")
        }
        query foo1 @send(to: "test1") {
          foo {
            ...CLIENT_SELECTION
          }
        }
        query foo2 @send(to: "test2") {
          foo {
            ...CLIENT_SELECTION
          }
        }
      `
    );

    await execute(
      `
        query {
          proxyFoo1 { ... on Bar { bar } }
          proxyFoo2 { ... on Baz { baz } }
        }
      `,
      {
        test1: { data: {
          foo: { ___t_test1: 'Bar', bar: 'test1::Bar::bar' }
        }},
        test2: { data: {
          foo: { ___t_test2: 'Baz', baz: 'test2::Baz::baz' }
        }},
      }
    );
  });

});
