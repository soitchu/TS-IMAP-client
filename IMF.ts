import { readFileSync } from "fs";
import { MailListItem } from "./IMAP";

// const IMFText = readFileSync("./IMF.txt", "utf-8");
// parseIMFMessage(IMFText);

export function parseIMFMessage(response: string) {
  const resultantList: MailListItem[] = [];
  const responseList = response.split("\n");
  const headers: { [key: string]: string } = {};
  const body: string[] = [""];

  let currentKey: string | undefined = undefined;
  let encodingType = "";
  let isMultipart = false;
  let multipartBoundary = "";
  let isBody = false;
  let firstBoundary = true;

  for (let line of responseList) {
    //  RFC5322: 2.2.3: Each header field is logically a single line of characters
    //  comprising the field name, the colon, and the field body.  For convenience
    //  however, and to deal with the 998/78 character limitations per line,
    //  the field body portion of a header field can be split into a
    //  multiple-line representation; this is called "folding".  The general
    //  rule is that wherever this specification allows for folding white
    //  space (not simply WSP characters), a CRLF may be inserted before any
    //  WSP.

    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      if (currentKey === "content-type") {
        encodingType = headers[currentKey];

        if (encodingType?.startsWith("multipart")) {
          isMultipart = true;
          multipartBoundary =
            "--" + encodingType.split('boundary="')[1].split('"')[0];
        } else {
          isMultipart = false;
        }
      }

      if (currentKey === "content-transfer-encoding") {
        isBody = true;
      }

      currentKey = line.split(":")[0].toLowerCase();

      // Removing the key
      if (!isBody) {
        line = line.substring(currentKey.length + 2);
      }
    } else if (line === ")") {
      isBody = false;
      continue;
    }

    if (currentKey === undefined) {
      throw new Error("currentKey was undefined");
    } else if (!isBody) {
      if (currentKey in headers) {
        headers[currentKey] += line;
      } else {
        headers[currentKey] = line;
      }
    } else {
      if (
        isMultipart &&
        (line === multipartBoundary || line === multipartBoundary + "--")
      ) {
        
        if(!firstBoundary) {
          isBody = false;
        }

        firstBoundary = false;
        body.push("");
      } else {
        body[body.length - 1] += line;
      }
    }
  }


  return [body, headers];
}
