import Transport from "@ledgerhq/hw-transport";
import { log } from "@ledgerhq/logs";
import axios from "axios";

export default class SpeculosTransport extends Transport {
  speculosUrl: string;

  constructor(speculosUrl: string) {
    super();
    this.speculosUrl = speculosUrl;
  }

  async exchange(_apdu: Buffer): Promise<Buffer> {
    try {
      log("apdu", "=>" + _apdu.toString("hex"));
      const response = await axios.post(`${this.speculosUrl}/apdu`, {
        data: _apdu.toString("hex"),
      });
      log("apdu", "<=" + response.data.data);
      return Buffer.from(response.data.data, "hex");
    } catch (error) {
      console.error("Error communicating with Speculos:", error);
      throw error;
    }
  }

  setScrambleKey() {
    // No need for scrambling in Speculos
  }

  async close() {
    // No cleanup needed for Speculos
  }
}

async function createSpeculosTransport(
  speculosUrl: string
): Promise<Transport> {
  return new SpeculosTransport(speculosUrl);
}
