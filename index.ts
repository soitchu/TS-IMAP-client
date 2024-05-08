import { existsSync, readFileSync, writeFileSync } from "fs";
import { FLAGS, Folder, IMAP, MailListItem } from "./IMAP";
import term from "terminal-kit";

const TUI = term.terminal;
const IMAPHelper = new IMAP();

interface Credentials {
  username: string;
  password: string;
  host: string;
  port: number;
}

TUI.on("key", function (name, matches, data) {
  if (name === "CTRL_C") {
    TUI.processExit(0);
  }
});

function print(message: string, color = "yellow", breakLine = true) {
  TUI.wrap[color](message + (breakLine ? "\n" : ""));
}

async function getInput(
  message: string,
  options: term.Terminal.InputFieldOptions = {}
): Promise<string> {
  print(message);
  return new Promise((resolve, reject) => {
    TUI.inputField(options, (error, response) => {
      if (error) reject(error);
      resolve(response as string);
      print("");
    });
  });
}

async function yesOrNo(message: string): Promise<boolean> {
  print(message + " (Y/N)");
  return new Promise((resolve, reject) => {
    TUI.yesOrNo({ yes: ["Y", "y"], no: ["N", "n"] }, (error, response) => {
      if (error) reject(error);
      resolve(response);
    });
  });
}

async function columnMenu(items: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    TUI.singleColumnMenu(items, {}, async (error, response) => {
      if (error) reject(error);
      resolve(response.selectedText);
    });
  });
}

async function saveCredentials(credentials: Credentials) {
  writeFileSync("./cred.json", JSON.stringify(credentials));
}

async function menuLogin() {
  const hasCred = existsSync("./cred.json");
  let credentials: Credentials = {
    username: "",
    password: "",
    host: "",
    port: 0,
  };

  if (!hasCred) {
    const username = await getInput("Username: ", {});

    const password = await getInput("Password: ", {
      echoChar: true,
    });

    const hostName = await getInput("Host name: ", {});

    const port = parseInt(await getInput("Port: ", {}));

    credentials = {
      username,
      password,
      host: hostName,
      port,
    };
  } else {
    credentials = JSON.parse(readFileSync("./cred.json", "utf-8"));
  }

  try {
    await IMAPHelper.init(credentials);
  } catch (err) {
    print(err.errorMessage, "red");
    print("Try again.", "red");
    await menuLogin();
  }

  if (!hasCred) {
    const shouldSave = await yesOrNo("Do you want to save your credentials?");

    if (shouldSave) {
      saveCredentials(credentials);
    }
  }

  print(`Logged in to ${credentials.host}:${credentials.port}!`, "blue");
}

async function listFolder(parentFolder: Folder, indent = 0) {
  for (const name in parentFolder) {
    const folderInfo = parentFolder[name];

    // console.log(folderInfo)
    print("   ".repeat(indent), "yellow", false);
    print(`(${folderInfo.unreadCount}) - `, "yellow", false);
    print(`(${name})`, "green");
    listFolder(folderInfo.children, indent + 1);
  }
}

function getFolderNames(parentFolder: Folder, folderNameList: string[] = []) {
  for (const name in parentFolder) {
    folderNameList.push(parentFolder[name].realName);
    getFolderNames(parentFolder[name].children, folderNameList);
  }

  return folderNameList;
}

async function menuDeleteFolder() {
  const parentFolder = await IMAPHelper.getFolderList();
  const selectedFolder = await columnMenu(getFolderNames(parentFolder));

  const isSure = await yesOrNo(
    `Are you sure you want to delete ${selectedFolder}?`
  );

  if (isSure) {
    await IMAPHelper.deleteFolder(selectedFolder);
    print("Deleted!", "blue");
  } else {
    print("Aborting", "red");
  }
}

async function menuAddFolder() {
  const parentFolder = await IMAPHelper.getFolderList();
  const folderNames = getFolderNames(parentFolder);
  folderNames.unshift("/");

  const selectedFolder = await columnMenu(folderNames);
  const name = await getInput("Enter the folder name: ");
  const parsedFolderName =
    selectedFolder === "/" ? name : selectedFolder + "/" + name;

  await IMAPHelper.addFolder(parsedFolderName);
  print("Created!", "blue");
}

async function menuListFolders() {
  const parentFolder = await IMAPHelper.getFolderList();

  listFolder(parentFolder);
}

async function menuSelectFolder() {
  const parentFolder = await IMAPHelper.getFolderList();
  const selectedFolder = await columnMenu(getFolderNames(parentFolder));
  await IMAPHelper.selectFolder(selectedFolder);
}

async function menuListEmails() {
  const mailList: MailListItem[] = await IMAPHelper.getEmails();

  const mailListTable = mailList.map((mail) => {
    const subject = mail.subject.substring(0, 50);

    return [
      ` ${mail.uid} `,
      ` ${mail.from} `,
      ` ${subject ? subject : "<EMPTY>"} `,
      ` ${mail.body}`,
      ` <${mail.flags.join("> <")}> `,
    ];
  });

  mailListTable.unshift([" UID ", " From ", " Subject ", " Date ", " Flags "]);

  TUI.table(mailListTable, { borderChars: "lightRounded" });
}

async function menuAlterFlag() {
  const mailList: MailListItem[] = await IMAPHelper.getEmails();
  const selectedEmail = await columnMenu(
    mailList.map((mail) => mail.uid.toString())
  );
  const selectedFlag = (await columnMenu(
    FLAGS as unknown as string[]
  )) as (typeof FLAGS)[number];
  const shouldAdd = await yesOrNo("Do you want to add this flag?");

  await IMAPHelper.alterFlag(selectedEmail, selectedFlag, shouldAdd);
  print(`${shouldAdd ? "Added" : "Removed"} the ${selectedFlag} flag!`, "blue");

  if (selectedFlag === "\\Deleted" && shouldAdd) {
    const shouldExpunge = await yesOrNo(
      "Do you want to permanently delete messages with the \\Deleted flag?"
    );

    if (shouldExpunge) {
      IMAPHelper.expunge();
    }
  }
}

async function menuCopyMove() {
  const mailList: MailListItem[] = await IMAPHelper.getEmails();
  const selectedEmail = await columnMenu(
    mailList.map((mail) => mail.uid.toString())
  );

  const selectedMailbox = await columnMenu(
    getFolderNames(IMAPHelper.cachedFolderInfo)
  );

  const shouldCopy = await yesOrNo(
    "Do you want to copy this email? 'Yes' to copy it, 'No' to move it."
  );

  await IMAPHelper.moveCopyEmail(selectedEmail, selectedMailbox, shouldCopy);
}

async function menuSubscribeFolder() {
  const folderList = await IMAPHelper.getAllFolders();
  const selectedFolder = await columnMenu(folderList);

  await IMAPHelper.subsribeFolder(selectedFolder);
}

async function menuUnsubscribeFolder() {
  const folderList = await IMAPHelper.getAllFolders();
  const selectedFolder = await columnMenu(folderList);

  await IMAPHelper.unsubsribeFolder(selectedFolder);
}

const mainMenuConfig = {
  Login: menuLogin,
  "Change active folder": menuSelectFolder,
  "Email options": {
    "List Emails": menuListEmails,
    "Alter Email flags": menuAlterFlag,
    "Copy/Move Email": menuCopyMove,
  },
  "Folder options": {
    "List Folders": menuListFolders,
    "Delete Folder": menuDeleteFolder,
    "Add Folder": menuAddFolder,
    "Subscribe Folder": menuSubscribeFolder,
    "Unsubscribe Folder": menuUnsubscribeFolder,
  },
  Exit: () => {
    TUI.processExit(0);
  },
};

let activeConfig = mainMenuConfig;
let selectionHist = [activeConfig];

function displayMenu() {
  const activeKeys: string[] = [];

  for (const key in activeConfig) {
    if (IMAPHelper.loggedIn && key === "Login") continue;
    activeKeys.push(key);
  }
  if (activeConfig != mainMenuConfig) {
    activeKeys.push("Back");
  }

  TUI.singleColumnMenu(
    IMAPHelper.loggedIn ? activeKeys : ["Login", "Exit"],
    {},
    async (error, response) => {
      try {
        const selectedOption = activeConfig[response.selectedText];

        if (typeof selectedOption === "function") {
          await selectedOption();
        } else {
          if (response.selectedText === "Back") {
            selectionHist.pop()
          } else {
            selectionHist.push(selectedOption);
          }

          activeConfig = selectionHist[selectionHist.length - 1];
        }
      } catch (err) {
        if ("errorMessage" in err) {
          print(err.errorMessage, "red");
        } else {
          print(err.toString(), "red");
        }
      }
      displayMenu();
    }
  );
}

displayMenu();
