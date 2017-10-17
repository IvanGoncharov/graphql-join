import {
  GraphQLError,
  DocumentNode,

  validate,

  ArgumentsOfCorrectTypeRule,
  KnownArgumentNamesRule,
  KnownDirectivesRule,
  ProvidedNonNullArgumentsRule,
  UniqueArgumentNamesRule,
  UniqueDirectivesPerLocationRule,
  UniqueInputFieldNamesRule,
} from 'graphql';

import { directiveSchema } from '../directives';

export function validateJoinIDL(ast: DocumentNode): Array<GraphQLError> {
  return validateDirectives(ast);
}

function validateDirectives(ast: DocumentNode): Array<GraphQLError> {
  // FIXME: should allow directives from sendTo remote schema on operations
  // FIXME: check that there no query arguments inside directive values
  return validate(directiveSchema, ast, [
    ArgumentsOfCorrectTypeRule,
    KnownArgumentNamesRule,
    KnownDirectivesRule,
    ProvidedNonNullArgumentsRule,
    UniqueArgumentNamesRule,
    UniqueDirectivesPerLocationRule,
    UniqueInputFieldNamesRule,
  ]);
  // TODO:
  // JOIN AST:
  //   - validate that all directive known and locations are correct
  //   - type refs should be resolved without conflicts
  //   - no specified directives inside join AST
  //   - all references to remote types have no conficts
  //   - all fields inside extends and type defs should have @resolveWith
  //   - all field args + all fragment exports used in operation
  //   - fields return types should match types returned by "query" including LIST and NON_NULL
  //   - TEMPORARY: @resolveWith for root fields shouldn't use fragments
  // schema:
  //   - check for subscription in schema and `Subscription` type and error as not supported
  //   - references to Query and Mutation roots point to exactly one remote type
  //   - reference only roots of the same type from remote schema
  // fragments:
  //   - shoud have uniq names
  //   - shouldn't reference other fragments
  //   - should have atleast one leaf
  //   - all scalars should have exports directive
  //   - names in export directive should be uniq
  //   - should be used in @resolveWith
  //   - no field alliases
  //   - forbid @skip/@include
  //   - TEMPORARY: fragment shouldn't contain fields with @resolveWith
  //   - should be used only on objects which is equal or inherate from type condition
  // operations:
  //   - only query and mutation no subscription
  //   - mutation should be used only on fields in mutation root
  //   - should have name
  //   - shoud have uniq names
  //   - should have @send(to:)
  //   - valid against external schema
  //   - should have exactly one "leaf" which is "{...CLIENT_SELECTION}" or scalar
  //   - don't reference other fragments
  //   - should be used in @resolveWith
  //   - no field alliases
  //   - forbid @skip/@include
}
