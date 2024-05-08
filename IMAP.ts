import { CONTEXT_DISABLED } from "terminal-kit/ScreenBufferHD";
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

const FLAGS = [
  "Seen",
  "Answered",
  "Flagged",
  "Deleted",
  "Draft",
  "Recent",
  "Forwarded",
  "MDNSent",
  "Junk",
  "NotJunk",
  "Phishing",
] as const;

// Note: "Recent" flag has been deprecated
export interface MailListItem {
  uid: number;
  flags: typeof FLAGS;
  subject: string;
  date: string;
  from: string;
  body: string[];
  rawBody: string;
}

export class IMAP {
  client: IMAPClient = new IMAPClient();
  loggedIn: boolean = false;
  cachedFolderInfo: Folder;

  parseParam(response: string, paramName: string) {
    const index = response.lastIndexOf(paramName) + paramName.length;
    const value = parseInt(response.substring(index));

    if (isNaN(value))
      throw new Error(
        `error while parsing ${response} to get the parameter ${paramName}`
      );

    return value;
  }

  parseMultiPartMessage() {}

  parseIMFList(response: string) {
    const resultantList: MailListItem[] = [];
    const responseList = response.split("\n");
    let currentListItem: MailListItem = undefined;
    let currentKey: string | undefined = undefined;
    let encodingType = "";
    let isMultipart = false;
    let multipartBoundary = "";
    let isBody = false;

    for (let line of responseList) {
      if (line.startsWith("*")) {
        // responseList
        if (currentListItem) {
          currentListItem.subject = currentListItem.subject.substring(
            0,
            currentListItem.subject.length - 1
          );
        }

        let rawFlags = line.match(/FLAGS \(.+?\)/g)![0];
        rawFlags = rawFlags.substring(
          rawFlags.indexOf("(") + 1,
          rawFlags.lastIndexOf(")")
        );

        isBody = false;
        currentListItem = {
          uid: this.parseParam(line, "UID"),
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

    // if(resultantList[1].)

    resultantList.reverse();
    // console.log(JSON.stringify(responseList, null, 4));
    console.log(resultantList[0].rawBody);
    console.log(parseIMFMessage(resultantList[0].rawBody));
    // console.log(responseList);
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

  async getFolderList() {
    const client = this.client;
    const tempList = (await client.send(`LIST (SUBSCRIBED) "" "*"`)).split(
      "\n"
    );

    // Removing empty string
    tempList.pop();
    // removing: <reqId> OK LIST completed
    tempList.pop();

    const folderListLinear = tempList.map((x) => {
      const name = x.split(" ")[4];
      return name.substring(1, name.length - 1).split("/");
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

  async selectFolder(folderName: string) {
    await this.client.send(`SELECT "${folderName}"`);
  }

  async init(config: IMAPConfig) {
    const client = this.client;
    await client.connect(config.host, config.port);
    await client.send("AUTHENTICATE PLAIN");
    await client.send(btoa(`\u0000${config.username}\u0000${config.password}`));
    await client.send(`SELECT "INBOX"`);

    this.cachedFolderInfo = await this.getFolderList();

    // console.log(
    await this.getEmails();
    // );

    this.loggedIn = true;
  }
}

const i = new IMAP();

i.init({
  username: "me",
  password: "suyash1234",
  host: "localhost",
  port: 143,
});

// BODY.PEEK[HEADER.FIELDS (Subject)]

// 420	11.241160252	fe80::42:aff:fe31:a7ed	fe80::42:aff:fe31:a7ed	IMAP	270	Request: 9 UID fetch 33 (UID RFC822.SIZE FLAGS BODY.PEEK[HEADER.FIELDS (Subject)])

// 8981	274.270520138	10.0.0.182	172.17.0.1	IMAP	234	Request: 0 UID FETCH 1:* (flags BODY.PEEK[HEADER.FIELDS (From To Cc Bcc Subject Date Message-ID Priority X-Priority References Newsgroups In-Reply-To Content-Type Reply-To)])
