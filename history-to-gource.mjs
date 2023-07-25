import * as fs from "fs/promises";

const root = "items/YOUR_DIRECTORY_ID";

function todo() {
  throw new Error("todo");
}

function assert(bool) {
  if (!bool) throw new Error("assert failed");
}

const data = await fs.readFile("./history.ndjson", "utf-8");

const paths = {};
const colors = {};

function getTargetId(activity) {
  assert(activity.targets.length == 1);

  if (activity.targets[0].driveItem) {
    return activity.targets[0].driveItem.name;
  } else if (activity.targets[0].fileComment) {
    return activity.targets[0].fileComment.parent.name;
  }

  todo();
}

function dateToUnix(date) {
  return Math.round(Date.parse(date) / 1000);
}

function getColor(mimeType) {
  const colors = {
    "application/msword": "0000FF",
    "application/pdf": "FF0000",
    "application/vnd.google-apps.document": "0000FF",
    "application/vnd.google-apps.folder": "FFFFFF",
    "application/vnd.google-apps.shortcut": "FFFFFF",
    "application/vnd.google-apps.spreadsheet": "00FF00",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "FFA500",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "00FF00",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "0000FF",
    "image/png": "FF00FF",
  };

  return colors[mimeType] || "FFFFFF";
}

// If `path` has prefix `oldPrefix`, return the path with the prefix
// `newPrefix` instead. Otherwise, return null.
function replacePathPrefix(path, oldPrefix, newPrefix) {
  if (path.length < oldPrefix.length) {
    // too short, couldn't have the prefix
    return null;
  }

  if (!oldPrefix.every((element, i) => path[i] == element)) {
    // doesn't have the prefix
    return null;
  }

  return [...newPrefix, ...path.slice(oldPrefix.length)];
}

function moveFolder(activity, oldFolder, newFolder) {
  // someone moved a folder. bad news for us.

  Object.keys(paths).forEach((itemId) => {
    const newPath = replacePathPrefix(paths[itemId], oldFolder, newFolder);

    if (newPath) {
      logAction(activity, "D", itemId);
      paths[itemId] = newPath;
      logAction(activity, "A", itemId);
    }
  });
}

function logAction(activity, type, target = getTargetId(activity)) {
  if (!paths[target]) {
    // sometimes google just doesn't give us a creation event for a file, so
    // we don't know where it is. this is rare enough that we can just ignore
    // events for such files
    return;
  }
  assert(colors[target]);
  console.log(
    `${dateToUnix(activity.timestamp)}|${
      activity.actors[0].user.info.names[0].displayName
    }|${type}|/${paths[target].join("/")}|${colors[target]}`
  );
}

data.split("\n").forEach((line) => {
  const activity = JSON.parse(line);

  //   console.log(JSON.stringify(activity));

  try {
    assert(activity.targets.length == 1);
    assert(activity.timestamp);

    if (activity.primaryActionDetail.create) {
      assert(activity.actors.length == 1);
      assert(activity.actors[0].user.knownUser.personName);
      if (getTargetId(activity) == root) {
        paths[getTargetId(activity)] = [];
        colors[getTargetId(activity)] = getColor(
          activity.targets[0].driveItem.mimeType
        );

        logAction(activity, "A");
      } else {
        const moveAction = activity.actions.find((x) => x.detail.move)?.detail
          ?.move;

        // generally, a document created in a directory is modelled as a create with a bundled move
        if (moveAction) {
          assert(moveAction.addedParents);
          assert(moveAction.addedParents.length == 1);
          assert(!moveAction.removedParents);
          assert(!paths[getTargetId(activity)]);

          const parent = paths[moveAction.addedParents[0].driveItem.name];
          assert(parent);
          paths[getTargetId(activity)] = [
            ...parent,
            activity.targets[0].driveItem.title,
          ];
        } else {
          // ...but sometimes there isn't a bundled move; in this case assume it was created in the root
          paths[getTargetId(activity)] = [
            ...paths[root],
            activity.targets[0].driveItem.title,
          ];
        }

        colors[getTargetId(activity)] = getColor(
          activity.targets[0].driveItem.mimeType
        );

        logAction(activity, "A");
      }
    } else if (activity.primaryActionDetail.move) {
      if (
        activity.primaryActionDetail.move.addedParents &&
        activity.primaryActionDetail.move.addedParents.length == 1 &&
        (!activity.primaryActionDetail.move.removedParents ||
          (activity.primaryActionDetail.move.removedParents.every(
            (p) => !paths[p.driveItem.name]
          ) &&
            !paths[getTargetId(activity)]))
      ) {
        // moved from outside; this is, for our purposes, a create

        const parent =
          paths[
            activity.primaryActionDetail.move.addedParents[0].driveItem.name
          ];
        assert(parent);
        paths[getTargetId(activity)] = [
          ...parent,
          activity.targets[0].driveItem.title,
        ];
        colors[getTargetId(activity)] = getColor(
          activity.targets[0].driveItem.mimeType
        );

        logAction(activity, "A");
      } else if (
        (!activity.primaryActionDetail.move.addedParents ||
          activity.primaryActionDetail.move.addedParents.every(
            (p) => !paths[p.driveItem.name]
          )) &&
        activity.primaryActionDetail.move.removedParents &&
        activity.primaryActionDetail.move.removedParents.every(
          (p) => paths[p.driveItem.name]
        ) &&
        paths[getTargetId(activity)]
      ) {
        // moved to outside; for our purposes, a delete

        logAction(activity, "D");

        delete paths[getTargetId(activity)];
      } else if (
        activity.primaryActionDetail.move.addedParents &&
        activity.primaryActionDetail.move.addedParents.length == 1 &&
        paths[
          activity.primaryActionDetail.move.addedParents[0].driveItem.name
        ] &&
        activity.primaryActionDetail.move.removedParents &&
        activity.primaryActionDetail.move.removedParents.length == 1 &&
        paths[
          activity.primaryActionDetail.move.removedParents[0].driveItem.name
        ]
      ) {
        // move within the folder

        assert(activity.targets[0].driveItem.file);

        logAction(activity, "D");

        const parent =
          paths[
            activity.primaryActionDetail.move.addedParents[0].driveItem.name
          ];
        assert(parent);
        paths[getTargetId(activity)] = [
          ...parent,
          activity.targets[0].driveItem.title,
        ];

        logAction(activity, "A");
      } else if (
        activity.primaryActionDetail.move.addedParents.every(
          (x) => !paths[x]
        ) &&
        activity.primaryActionDetail.move.removedParents.every((x) => !paths[x])
      ) {
        // moved from an external folder to another external folder. not
        // entirely sure why we get these - maybe things that end up in
        // scope later? in any case, ignore it
      } else {
        todo();
      }
    } else if (activity.primaryActionDetail.comment) {
      logAction(activity, "M");
    } else if (activity.primaryActionDetail.rename) {
      logAction(activity, "D");

      const path = paths[getTargetId(activity)];
      if (!path) {
        // rename of a file we never got creation for. google works in
        // mysterious ways.
        return;
      }
      const oldPath = [...path];
      path[path.length - 1] = activity.primaryActionDetail.rename.newTitle;

      logAction(activity, "A");

      if (activity.targets[0].driveItem.driveFolder) {
        moveFolder(activity, oldPath, path);
      }
    } else if (activity.primaryActionDetail.edit) {
      logAction(activity, "M");
    } else if (activity.primaryActionDetail.permissionChange) {
      logAction(activity, "M");
    } else {
      todo();
    }
  } catch (e) {
    console.log(JSON.stringify(activity));
    throw e;
  }
});