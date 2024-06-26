import { IMAPClient } from "./IMAPClient";
import { parseIMFMessage } from "./IMF";

export type Folder = {
  [key: string]: {
    realName: string;
    uidnext: number;
    totalMessages: number;
    unreadCount: number;
    recent: number;
    children: Folder;
  };
};

interface IMAPConfig {
  username: string;
  password: string;
  host: string;
  port: number;
}

export const FLAGS = [
  "\\Seen",
  "\\Answered",
  "\\Flagged",
  "\\Deleted",
  "\\Draft",
  "\\Recent",
  "Forwarded",
  "MDNSent",
  "Junk",
  "NotJunk",
  "Phishing",
] as const;

// Note: "Recent" flag has been deprecated
export interface MailListItem {
  uid: number;
  flags: (typeof FLAGS)[number][];
  subject: string;
  date: string;
  from: string;
  body: string[];
  rawBody: string;
}

function substringAfter(str: string, delimiter: string) {
  const index = str.indexOf(delimiter);
  return str.substring(index + delimiter.length);
}

function substringAfterLast(str: string, delimiter: string) {
  const index = str.lastIndexOf(delimiter);
  return str.substring(index + delimiter.length);
}

function substringBefore(str: string, delimiter: string) {
  const index = str.lastIndexOf(delimiter);
  return str.substring(0, index);
}

export class IMAP {
  client: IMAPClient = new IMAPClient();
  loggedIn: boolean = false;
  cachedFolderInfo: Folder;

  private parseParam(response: string, paramName: string) {
    const index = response.lastIndexOf(paramName) + paramName.length;
    const value = parseInt(response.substring(index));

    if (isNaN(value))
      throw new Error(
        `error while parsing ${response} to get the parameter ${paramName}`
      );

    return value;
  }

  private parseIMFList(response: string) {
    const resultantList: MailListItem[] = [];
    const responseList = response.split("\n");
    // @ts-expect-error
    let currentListItem: MailListItem = undefined;

    if (!responseList[0].startsWith("*")) {
      return [];
    }

    for (let line of responseList) {
      if (line.startsWith("*")) {
        if (currentListItem) {
          currentListItem.subject = currentListItem.subject.substring(
            0,
            currentListItem.subject.length - 1
          );
        }

        let tempFlagsMatch = line.match(/FLAGS \(.+?\)/g);
        let rawFlags = "";

        if (tempFlagsMatch !== null) {
          rawFlags = tempFlagsMatch[0].substring(
            tempFlagsMatch[0].indexOf("(") + 1,
            tempFlagsMatch[0].lastIndexOf(")")
          );
        }

        currentListItem = {
          uid: this.parseParam(line, "UID"),
          // @ts-expect-error
          flags: rawFlags.split(" ").map((x) => {
            // RFC 9051 2.3.2: A system flag is a flag name that is predefined
            // in this specification and begins with "\"
            if (x.startsWith("\\")) x = x.substring(1);
            return x;
          }),
          subject: "",
          date: "",
          from: "",
          body: [""],
          rawBody: "",
        };

        resultantList.push(currentListItem!);
      } else if (line.startsWith(")")) {
        continue;
      } else {
        currentListItem.rawBody += line + "\n";
      }
    }

    resultantList.reverse();

    for (let i = 0; i < resultantList.length; i++) {
      const parsedBody = parseIMFMessage(resultantList[i].rawBody);

      resultantList[i].body = parsedBody[0][0];

      // Copy all the keys
      Object.assign(resultantList[i], parsedBody[1]);
    }

    return resultantList;
  }

  async getFolderInformation(folderName: string) {
    const client = this.client;
    const response = (
      await client.send(
        `STATUS "${folderName}" (UIDNEXT MESSAGES UNSEEN RECENT)`
      )
    ).split("\n")[0];
    return {
      UIDNEXT: this.parseParam(response, "UIDNEXT"),
      MESSAGES: this.parseParam(response, "MESSAGES"),
      UNSEEN: this.parseParam(response, "UNSEEN"),
      RECENT: this.parseParam(response, "RECENT"),
    };
  }

  async getAllFolders() {
    const client = this.client;
    const tempList = (await client.send(`LIST () "" "*"`)).split("\n");

    const folderListLinear = tempList.map((x) => {
      return substringAfterLast(substringBefore(x, `"`), `"`);
    });

    return folderListLinear;
  }

  async getFolderList() {
    const client = this.client;
    const tempList = (await client.send(`LIST (SUBSCRIBED) "" "*"`)).split(
      "\n"
    );

    // removing: <reqId> OK LIST completed
    // tempList.pop();

    const folderListLinear = tempList.map((x) => {
      return substringAfterLast(substringBefore(x, `"`), `"`).split("/");
    });

    const inboxInfo = await this.getFolderInformation("INBOX");

    const folders: Folder = {
      INBOX: {
        realName: "INBOX",
        uidnext: inboxInfo.UIDNEXT,
        unreadCount: inboxInfo.UNSEEN,
        recent: inboxInfo.RECENT,
        totalMessages: inboxInfo.MESSAGES,
        children: {},
      },
    };

    for (let i = 0; i < folderListLinear.length; i++) {
      const currentFolder = folderListLinear[i];
      const folderName = currentFolder[currentFolder.length - 1];
      const realFolderName = currentFolder.join("/");

      if (realFolderName === "INBOX") continue;

      const folderMetaData = await this.getFolderInformation(realFolderName);

      let parentFolder = folders;

      for (let i = 0; i < currentFolder.length; i++) {
        if (currentFolder[i] in parentFolder) {
          parentFolder = parentFolder[currentFolder[i]].children;
        } else {
          break;
        }
      }

      parentFolder[folderName] = {
        realName: realFolderName,
        uidnext: folderMetaData.UIDNEXT,
        unreadCount: folderMetaData.UNSEEN,
        recent: folderMetaData.RECENT,
        totalMessages: folderMetaData.MESSAGES,
        children: {},
      };
    }

    this.cachedFolderInfo = folders;

    return folders;
  }

  async addFolder(folderName: string) {
    const client = this.client;
    let response = await client.send(`CREATE ${folderName}`);
    response += await client.send(`SUBSCRIBE ${folderName}`);

    return response;
  }

  async deleteFolder(folderName: string) {
    const client = this.client;

    return await client.send(`DELETE ${folderName}`);
  }

  async getEmails() {
    const client = this.client;

    const response = await client.send(
      `UID FETCH 1:* (FLAGS BODY.PEEK[])`,
      false
    );

    return this.parseIMFList(response).reverse();
  }

  async moveCopyEmail(uid: string, mailboxName: string, shouldCopy: boolean) {
    await this.client.send(
      `UID ${shouldCopy ? "COPY" : "MOVE"} ${uid} ${mailboxName}`,
      false
    );
  }

  async alterFlag(uid: string, flag: (typeof FLAGS)[number], shouldAdd = true) {
    await this.client.send(
      `UID STORE ${uid} ${shouldAdd ? "+" : "-"}FLAGS (${flag})`,
      false
    );
  }

  async expunge() {
    await this.client.send(`EXPUNGE`, false);
  }

  async selectFolder(folderName: string) {
    await this.client.send(`SELECT "${folderName}"`);
  }

  async subsribeFolder(folderName: string) {
    await this.client.send(`SUBSCRIBE "${folderName}"`);
  }

  async unsubsribeFolder(folderName: string) {
    await this.client.send(`UNSUBSCRIBE "${folderName}"`);
  }

  async init(config: IMAPConfig) {
    const client = this.client;
    await client.connect(config.host, config.port);
    await client.send("AUTHENTICATE PLAIN");
    await client.send(btoa(`\u0000${config.username}\u0000${config.password}`));
    await client.send(`SELECT "INBOX"`);
    await this.getFolderList();

    // console.log((await client.send(`SELECT "INBOX"`)));
    // console.log(await this.getAllFolders());
    this.loggedIn = true;
  }
}
