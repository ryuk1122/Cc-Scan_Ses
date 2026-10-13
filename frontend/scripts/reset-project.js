#!/usr/bin/env node

/**
 * Reinicia el proyecto a un estado limpio.
 * Mueve o borra las carpetas /app, /components, /hooks, /scripts y /constants,
 * y crea una nueva carpeta /app con index.tsx y _layout.tsx.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const root = process.cwd();
const oldDirs = ["app", "components", "hooks", "constants", "scripts"];
const exampleDir = "app-example";
const newAppDir = "app";
const exampleDirPath = path.join(root, exampleDir);

const indexContent = `import { Text, View } from "react-native";

export default function Index() {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text>Edita app/index.tsx para cambiar esta pantalla.</Text>
    </View>
  );
}
`;

const layoutContent = `import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack />;
}
`;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const moveDirectories = async (userInput) => {
  try {
    const shouldMove = userInput === "s" || userInput === "y";

    if (shouldMove) {
      await fs.promises.mkdir(exampleDirPath, { recursive: true });
      console.log(`Carpeta /${exampleDir} creada.`);
    }

    for (const dir of oldDirs) {
      const oldDirPath = path.join(root, dir);
      if (fs.existsSync(oldDirPath)) {
        if (shouldMove) {
          const newDirPath = path.join(root, exampleDir, dir);
          await fs.promises.rename(oldDirPath, newDirPath);
          console.log(`/${dir} movida a /${exampleDir}/${dir}.`);
        } else {
          await fs.promises.rm(oldDirPath, { recursive: true, force: true });
          console.log(`/${dir} borrada.`);
        }
      } else {
        console.log(`/${dir} no existe; se omite.`);
      }
    }

    const newAppDirPath = path.join(root, newAppDir);
    await fs.promises.mkdir(newAppDirPath, { recursive: true });
    console.log("\nCarpeta /app creada.");

    const indexPath = path.join(newAppDirPath, "index.tsx");
    await fs.promises.writeFile(indexPath, indexContent);
    console.log("app/index.tsx creado.");

    const layoutPath = path.join(newAppDirPath, "_layout.tsx");
    await fs.promises.writeFile(layoutPath, layoutContent);
    console.log("app/_layout.tsx creado.");

    console.log("\nProyecto reiniciado. Siguientes pasos:");
    console.log(
      `1. Ejecuta \`npx expo start\` para iniciar el servidor de desarrollo.\n2. Edita app/index.tsx para cambiar la pantalla principal.${
        shouldMove ? `\n3. Borra la carpeta /${exampleDir} cuando ya no la necesites.` : ""
      }`,
    );
  } catch (error) {
    console.error(`Error durante la ejecución del script: ${error.message}`);
  }
};

rl.question("¿Quieres mover los archivos existentes a /app-example en vez de borrarlos? (S/n): ", (answer) => {
  const userInput = answer.trim().toLowerCase() || "s";
  if (userInput === "s" || userInput === "y" || userInput === "n") {
    moveDirectories(userInput).finally(() => rl.close());
  } else {
    console.log("Respuesta inválida. Escribe S o N.");
    rl.close();
  }
});
