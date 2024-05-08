export function parseIMFMessage(response: string) {
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

          // Storing the boundary string so it can be used to detect the 
          // the end and start of bodies
          multipartBoundary =
            "--" + encodingType.split('boundary="')[1].split('"')[0];
        } else {
          isMultipart = false;
        }
      }

      // Body is followed by the content-transfer-encoding header
      if (currentKey === "content-transfer-encoding") {
        isBody = true;
      }

      // "line" looks something like:
      // content-type: multipart/alternative
      // so this grabs the "content-type", which is the key
      currentKey = line.split(":")[0].toLowerCase();

      if (!isBody) {
      // Removing the key from the line and getting the value 
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
        // Appending to the string if it already exists
        headers[currentKey] += line;
      } else {
        // Assining the string to the key
        headers[currentKey] = line;
      }
    } else {

      // If it's a multipart response, and the we encounter
      // the boundary string
      if (
        isMultipart &&
        (line === multipartBoundary || line === multipartBoundary + "--")
      ) {
        
        // If this isn't first time we have encountered the boundary,
        // then that means the next few lines will be header, so we set
        // isBody to false
        if(!firstBoundary) {
          isBody = false;
        }

        firstBoundary = false;

        // Adding a new body to the array if it isn't the end of the 
        // multipart body
        if(line !== multipartBoundary + "--") {
          body.push("");
        }
      } else {
        // Appending the line to the body
        body[body.length - 1] += line;
      }
    }
  }
  return [body, headers];
}
