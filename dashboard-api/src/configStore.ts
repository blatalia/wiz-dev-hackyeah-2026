import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export type SettingValue = boolean | number;
export type ConfigSetting = { key: string; value: SettingValue };
export type ConfigGroup = { key: string; settings: ConfigSetting[] };
export type GatewayConfig = { configId: string; groups: ConfigGroup[] };
export type ConfigChange = { group: string; key: string; value: SettingValue };

export interface ConfigStore {
  getConfig(configId: string): Promise<GatewayConfig | null>;
  applyChanges(configId: string, changes: ConfigChange[]): Promise<GatewayConfig | null>;
}

const isSetting = (v: unknown): v is SettingValue => typeof v === "boolean" || typeof v === "number";
const isMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function settingsOf(entries: [string, unknown][]): ConfigSetting[] {
  return entries
    .filter((e): e is [string, SettingValue] => isSetting(e[1]))
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function toConfig(item: Record<string, unknown>): GatewayConfig {
  const entries = Object.entries(item).filter(([key]) => key !== "configId");
  const groups: ConfigGroup[] = [
    { key: "", settings: settingsOf(entries) },
    ...entries
      .filter((e): e is [string, Record<string, unknown>] => isMap(e[1]))
      .map(([key, map]) => ({ key, settings: settingsOf(Object.entries(map)) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  ];
  return { configId: String(item.configId), groups: groups.filter((g) => g.settings.length > 0) };
}

export class DynamoConfigStore implements ConfigStore {
  private doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT || undefined }));
  private table = process.env.CONFIG_TABLE || "ai-gateway-config";

  async getConfig(configId: string) {
    const out = await this.doc.send(new GetCommand({
      TableName: this.table, Key: { configId }, ConsistentRead: true,
    }));
    return out.Item ? toConfig(out.Item) : null;
  }

  async applyChanges(configId: string, changes: ConfigChange[]) {
    const names: Record<string, string> = {};
    const values: Record<string, SettingValue> = {};
    const paths = changes.map((c, i) => {
      names[`#k${i}`] = c.key;
      values[`:v${i}`] = c.value;
      if (c.group === "") return `#k${i}`;
      names[`#g${i}`] = c.group;
      return `#g${i}.#k${i}`;
    });

    try {
      const out = await this.doc.send(new UpdateCommand({
        TableName: this.table,
        Key: { configId },
        UpdateExpression: "SET " + paths.map((p, i) => `${p} = :v${i}`).join(", "),
        ConditionExpression: paths.map((p) => `attribute_exists(${p})`).join(" AND "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }));
      return out.Attributes ? toConfig(out.Attributes) : null;
    } catch (e) {
      if ((e as Error).name === "ConditionalCheckFailedException") return null;
      throw e;
    }
  }
}
