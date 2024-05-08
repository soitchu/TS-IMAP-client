import net, { Socket } from "node:net";

export class IMAPClient {
  requestId: number = 0;
  promises: {
    [key: number]: {
      resolve: (value: string) => void;
      reject: (value: { errorMessage: string; fullResponse: string }) => void;
    };
  } = {};
  lastRequestId = 0;
  lastRead = 0;
  client: Socket;
  expectIMF = false;
  buffer: string[] = [];
  bufferMode = false;

  async send(command: string, untagged: boolean = false): Promise<string> {
    let requestId = this.requestId;

    if (!untagged) {
      requestId++;
      this.lastRequestId = requestId;
    }

    return new Promise((resolve, reject) => {
      this.promises[requestId] = {
        resolve,
        reject,
      };
      this.client.write(`${requestId} ${command}\n`);
    });
  }

  error(message: string): never {
    throw new Error(message);
  }

  connect(host: string, port = 143) {
    return new Promise((resolve) => {
      this.client = net.connect(
        {
          host: host,
          port: port,
          onread: {
            buffer: Buffer.allocUnsafe(4096),
            callback: (size, buf) => {
              const responses = new TextDecoder()
                .decode(buf.slice(0, size))
                .split("\r\n");

              // console.log(new TextDecoder().decode(buf.slice(0, size)));

              // console.log(new TextDecoder().decode(buf.slice(0, size)));

              for (const response of responses) {
                // if it's an empty string
                if (!response) continue;

                // RFC 9051 2.2.2: Data transmitted by the server to the client and status
                // responses that do not indicate command completion are prefixed with the token
                // "*" and are called untagged responses.
                if (response.charAt(0) === "*") {
                  this.bufferMode = true;
                  this.buffer.push(response);
                  continue;
                }

                // RFC 9051 2.2.1: ...the server sends a command continuation request response if it is
                // ready for the octets (if appropriate) and the remainder of the command.
                // This response is prefixed with the token "+"
                else if (response.charAt(0) === "+") {
                  this.bufferMode = false;
                  this.promises[this.lastRequestId].resolve("");
                }

                // RFC 9051 2.2.1: Each client command is prefixed with an identifier (typically a
                // short alphanumeric string, e.g., A0001, A0002, etc.) called a "tag"
                else {
                  const status = response.split(" ")[1] as "OK" | "NO";
                  const requestId =
                    response.startsWith("\t") || response.startsWith(" ") || (status !== "OK" && status !== "NO")
                      ? NaN
                      : parseInt(response);

                  // console.log(response);

                  if (isNaN(requestId)) {
                    if (this.bufferMode) {
                      this.buffer.push(response);
                      continue;
                    } else {
                      this.error(
                        "Was expecting a tagged response, but found:\n" +
                          response
                      );
                    }
                  } else {
                  }


                  if (status === "NO") {
                    this.promises[requestId].reject({
                      errorMessage: response,
                      fullResponse: responses.join("\n"),
                    });
                  } else {
                    let finalResponse = this.bufferMode
                      ? this.buffer.join("\n")
                      : responses.join("\n");

                    // console.log(
                    //   requestId,
                    //   this.promises,
                    //   response,
                    //   response.startsWith("\t")
                    // );
                    this.promises[requestId].resolve(finalResponse);
                  }

                  this.buffer = [];
                  this.bufferMode = false;
                }
              }

              return true;
            },
          },
        },
        resolve as () => {}
      );
    });
  }
}
