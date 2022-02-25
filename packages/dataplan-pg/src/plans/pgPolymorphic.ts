import type {
  CrystalResultsList,
  CrystalValuesList,
  PolymorphicData,
  PolymorphicPlan,
} from "graphile-crystal";
import {
  arraysMatch,
  ExecutablePlan,
  isDev,
  polymorphicWrap,
} from "graphile-crystal";
import type { GraphQLObjectType } from "graphql";
import { inspect } from "util";

import type { PgSourceColumns } from "../datasource";
import type { PgTypeCodec } from "../interfaces";
import type { PgClassExpressionPlan } from "./pgClassExpression";
import type { PgSelectSinglePlan } from "./pgSelectSingle";

export interface PgPolymorphicTypeMap<
  TItemPlan extends
    | PgSelectSinglePlan<any, any, any, any>
    | PgClassExpressionPlan<any, any, any, any, any, any>,
  TTypeSpecifier,
  TTypeSpecifierPlan extends ExecutablePlan<TTypeSpecifier> = ExecutablePlan<TTypeSpecifier>,
> {
  [typeName: string]: {
    match(specifier: TTypeSpecifier): boolean;
    plan($specifier: TTypeSpecifierPlan, $item: TItemPlan): ExecutablePlan<any>;
  };
}

export class PgPolymorphicPlan<
    TItemPlan extends
      | PgSelectSinglePlan<any, any, any, any>
      | PgClassExpressionPlan<any, any, any, any, any, any>,
    TTypeSpecifier,
    TTypeSpecifierPlan extends ExecutablePlan<TTypeSpecifier> = ExecutablePlan<TTypeSpecifier>,
  >
  extends ExecutablePlan<any>
  implements PolymorphicPlan
{
  static $$export = {
    moduleName: "@dataplan/pg",
    exportName: "PgPolymorphicPlan",
  };
  sync = true;

  private typeSpecifierPlanId: number;
  private itemPlanId: number;
  private types: string[];

  constructor(
    $itemPlan: TItemPlan,
    $typeSpecifierPlan: TTypeSpecifierPlan,
    private possibleTypes: PgPolymorphicTypeMap<
      TItemPlan,
      TTypeSpecifier,
      TTypeSpecifierPlan
    >,
  ) {
    super();
    this.itemPlanId = this.addDependency($itemPlan);
    this.typeSpecifierPlanId = this.addDependency($typeSpecifierPlan);
    this.types = Object.keys(possibleTypes);
  }

  itemPlan(): TItemPlan {
    const plan = this.getPlan(this.dependencies[this.itemPlanId]);
    return plan as any;
  }

  typeSpecifierPlan(): TTypeSpecifierPlan {
    const plan = this.getPlan(
      this.dependencies[this.typeSpecifierPlanId],
    ) as TTypeSpecifierPlan;
    return plan;
  }

  planForType(type: GraphQLObjectType): ExecutablePlan {
    const spec = this.possibleTypes[type.name];
    if (!spec) {
      throw new Error(
        `${this} could resolve to ${
          type.name
        }, but can only handle the following types: '${Object.keys(
          this.possibleTypes,
        ).join("', '")}'`,
      );
    }
    return spec.plan(this.typeSpecifierPlan(), this.itemPlan());
  }

  private getTypeNameFromSpecifier(specifier: TTypeSpecifier) {
    const t = this.types.find((t) => this.possibleTypes[t].match(specifier));
    if (!t) {
      if (isDev) {
        console.error(
          `Could not find a type that matched the specifier '${inspect(
            specifier,
          )}'`,
        );
      }
      throw new Error(
        "Could not determine the type to use for this polymorphic value.",
      );
    }
    return t;
  }

  execute(
    values: Array<CrystalValuesList<any>>,
  ): CrystalResultsList<PolymorphicData<
    string,
    ReadonlyArray<any> // TODO: something to do with TCodec
  > | null> {
    return values[this.typeSpecifierPlanId].map((specifier) => {
      if (specifier) {
        const typeName = this.getTypeNameFromSpecifier(specifier);
        return polymorphicWrap(typeName);
      } else {
        return null;
      }
    });
  }
}

export function pgPolymorphic<
  TItemPlan extends
    | PgSelectSinglePlan<any, any, any, any>
    | PgClassExpressionPlan<any, any, any, any, any, any>,
  TTypeSpecifier = any,
  TTypeSpecifierPlan extends ExecutablePlan<TTypeSpecifier> = ExecutablePlan<TTypeSpecifier>,
>(
  $itemPlan: TItemPlan,
  $typeSpecifierPlan: TTypeSpecifierPlan,
  possibleTypes: PgPolymorphicTypeMap<
    TItemPlan,
    TTypeSpecifier,
    TTypeSpecifierPlan
  >,
): PgPolymorphicPlan<TItemPlan, TTypeSpecifier, TTypeSpecifierPlan> {
  return new PgPolymorphicPlan<TItemPlan, TTypeSpecifier, TTypeSpecifierPlan>(
    $itemPlan,
    $typeSpecifierPlan,
    possibleTypes,
  );
}

Object.defineProperty(pgPolymorphic, "$$export", {
  value: {
    moduleName: "@dataplan/pg",
    exportName: "pgPolymorphic",
  },
});
