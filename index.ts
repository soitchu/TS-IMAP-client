import { existsSync, readFileSync, writeFileSync } from "fs";
import { Folder, IMAP, MailListItem } from "./IMAP";
import term from "terminal-kit";
import { execFileSync } from "child_process";

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
  await IMAPHelper.addFolder(selectedFolder + "/" + name);
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

  TUI.table(mailListTable, {borderChars: "lightRounded"});
}

const mainMenuConfig = {
  Login: menuLogin,
  "List Emails": menuListEmails,
  "List Folders": menuListFolders,
  "Delete Folder": menuDeleteFolder,
  "Add Folder": menuAddFolder,
  "Change active folder": menuSelectFolder,
  Exit: () => {
    TUI.processExit(0);
  },
};

function displayMenu() {
  TUI.singleColumnMenu(
    IMAPHelper.loggedIn ? Object.keys(mainMenuConfig) : ["Login", "Exit"],
    {},
    async (error, response) => {
      try {
        await mainMenuConfig[response.selectedText]();
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