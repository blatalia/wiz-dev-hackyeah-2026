import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

// Конфіг gateway: один запис з набором перемикачів (true/false).
export type GatewayConfig = { configId: string; flags: Record<string, boolean> };

export interface ConfigStore {
  getConfig(configId: string): Promise<GatewayConfig | null>;
  // Міняє тільки передані перемикачі, решту запису не чіпає.
  // null = запису немає або в ньому немає такого перемикача.
  setFlags(configId: string, flags: Record<string, boolean>): Promise<GatewayConfig | null>;
}

// Таблиця gateway в AWS: ключ configId, перемикачі лежать як булеві атрибути запису
export class DynamoConfigStore implements ConfigStore {
  private doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT || undefined }));
  private table = process.env.CONFIG_TABLE || "ai-gateway-config";

  private toConfig(item: Record<string, unknown>): GatewayConfig {
    const flags: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === "boolean") flags[key] = value;
    }
    return { configId: String(item.configId), flags };
  }

  async getConfig(configId: string) {
    const out = await this.doc.send(new GetCommand({
      TableName: this.table, Key: { configId }, ConsistentRead: true,
    }));
    return out.Item ? this.toConfig(out.Item) : null;
  }

  async setFlags(configId: string, flags: Record<string, boolean>) {
    const keys = Object.keys(flags);
    const names: Record<string, string> = {};
    const values: Record<string, boolean> = {};
    keys.forEach((key, i) => {
      names[`#f${i}`] = key;
      values[`:v${i}`] = flags[key];
    });

    try {
      const out = await this.doc.send(new UpdateCommand({
        TableName: this.table,
        Key: { configId },
        UpdateExpression: "SET " + keys.map((_, i) => `#f${i} = :v${i}`).join(", "),
        // не створюємо ні новий запис, ні нові атрибути: тільки те, що gateway вже знає
        ConditionExpression: keys.map((_, i) => `attribute_exists(#f${i})`).join(" AND "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }));
      return out.Attributes ? this.toConfig(out.Attributes) : null;
    } catch (e) {
      if ((e as Error).name === "ConditionalCheckFailedException") return null;
      throw e;
    }
  }
}
