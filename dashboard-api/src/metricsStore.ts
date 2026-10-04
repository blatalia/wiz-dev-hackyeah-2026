import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

export type GatewayMetrics = { timestamp: string | null; metrics: Record<string, unknown> };

export class DynamoMetricsStore {
  private doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT || undefined }));
  private table = process.env.METRICS_TABLE || "ai-gateway-metrics";

  async getCurrent(): Promise<GatewayMetrics | null> {
    const out = await this.doc.send(new GetCommand({
      TableName: this.table, Key: { pk: "METRICS", sk: "CURRENT" },
    }));
    if (!out.Item) return null;
    const metrics = out.Item.metrics;
    return {
      timestamp: typeof out.Item.timestamp === "string" ? out.Item.timestamp : null,
      metrics: typeof metrics === "object" && metrics !== null ? metrics : {},
    };
  }
}
