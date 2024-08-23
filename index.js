#!/usr/bin/env node

import inquirer from "inquirer"
import chalk from "chalk"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { $ } from "zx"
import Table from "cli-table3"
import { createRequire } from "module"
const require = createRequire(import.meta.url)
const { version, homepage } = require("./package.json")

$.verbose = false

const fetchSimulators = async () => {
  const { stdout } = await $`xcrun simctl list devices --json`
  return JSON.parse(stdout).devices
}

const fetchDeviceTypes = async () => {
  const { stdout } = await $`xcrun simctl list devicetypes --json`
  return JSON.parse(stdout).devicetypes
}

const parseRuntimeToVersion = (runtime) => {
  const match = runtime.match(/iOS-(\d+)-(\d+)/)
  return match ? `iOS ${match[1]}.${match[2]}` : "Unknown"
}

const listSimulators = async () => {
  const devices = await fetchSimulators()
  const sortedRuntimes = Object.keys(devices).sort((a, b) => {
    const versionA = parseRuntimeToVersion(a).match(/iOS (\d+\.\d+)/)
      ? parseFloat(parseRuntimeToVersion(a).match(/iOS (\d+\.\d+)/)[1])
      : 0
    const versionB = parseRuntimeToVersion(b).match(/iOS (\d+\.\d+)/)
      ? parseFloat(parseRuntimeToVersion(b).match(/iOS (\d+\.\d+)/)[1])
      : 0
    return versionB - versionA
  })

  let totalSimulators = 0
  const table = new Table({
    head: ["Name", "OS Version", "UDID", "State", "Available"],
    colAligns: ["left", "left", "left", "left", "left"],
  })

  sortedRuntimes.forEach((runtime) => {
    if (devices[runtime].length > 0) {
      const version = parseRuntimeToVersion(runtime)
      devices[runtime].forEach((device) => {
        const availability = device.isAvailable ? "Yes" : "No"
        table.push([
          device.name,
          version,
          device.udid,
          device.state,
          availability,
        ])
        totalSimulators++
      })
    }
  })

  if (totalSimulators > 0) {
    console.log(table.toString())
  } else {
    console.log(
      chalk.yellow(
        'No simulators found. Consider creating one using the "create" command.',
      ),
    )
  }
}

const listRemoteSimulators = async () => {
  const deviceTypes = await fetchDeviceTypes()

  const table = new Table({
    head: ["Name", "Identifier", "Min Runtime", "Max Runtime"],
    colAligns: ["left", "left", "left", "left"],
  })

  deviceTypes.forEach((deviceType) => {
    table.push([
      deviceType.name,
      deviceType.identifier,
      deviceType.minRuntimeVersionString,
      deviceType.maxRuntimeVersionString,
    ])
  })

  if (deviceTypes.length > 0) {
    console.log(table.toString())
  } else {
    console.log(chalk.yellow("No remote simulators found."))
  }
}

const getRuntimes = async () => {
  const { stdout } = await $`xcrun simctl list runtimes --json`
  const runtimes = JSON.parse(stdout).runtimes
  return runtimes
}

const getDeviceTypes = async () => {
  const { stdout } = await $`xcrun simctl list devicetypes --json`
  const deviceTypes = JSON.parse(stdout).devicetypes
  return deviceTypes
}

const createSimulator = async () => {
  const deviceTypes = await getDeviceTypes()
  const deviceTypeChoices = deviceTypes.map((deviceType) => ({
    name: `${deviceType.name} (${deviceType.identifier})`,
    value: deviceType.identifier,
    short: deviceType.name,
  }))

  const runtimes = await getRuntimes()
  const runtimeChoices = runtimes.map((runtime) => ({
    name: `${runtime.name} (${runtime.identifier})`,
    value: runtime.identifier,
    short: runtime.name.replace(/.*(iOS \d+.\d+).*/, "$1"),
  }))

  const deviceAndRuntime = await inquirer.prompt([
    {
      type: "list",
      name: "deviceType",
      message: "Choose the device type for your simulator:",
      choices: deviceTypeChoices,
    },
    {
      type: "list",
      name: "runtime",
      message: "Choose the iOS runtime for your simulator:",
      choices: runtimeChoices,
    },
  ])

  const deviceTypeName = deviceTypeChoices.find(
    (d) => d.value === deviceAndRuntime.deviceType,
  ).short
  const runtimeName = runtimeChoices.find(
    (r) => r.value === deviceAndRuntime.runtime,
  ).short
  const defaultSimulatorName = `${deviceTypeName} - ${runtimeName}`

  const { deviceName } = await inquirer.prompt([
    {
      type: "input",
      name: "deviceName",
      message: "Name your simulator:",
      default: defaultSimulatorName,
    },
  ])

  try {
    await $`xcrun simctl create ${deviceName} ${deviceAndRuntime.deviceType} ${deviceAndRuntime.runtime}`
    console.log(chalk.green(`Simulator ${deviceName} created successfully.`))
  } catch (error) {
    if (error.stdout.includes("Incompatible device")) {
      console.error(
        chalk.red(
          `Failed to create simulator: The chosen device type and runtime are incompatible. Please try a different combination.`,
        ),
      )
    } else {
      console.error(chalk.red(`Failed to create simulator: ${error}`))
    }
  }
}

const deleteSimulator = async () => {
  const devices = await fetchSimulators()
  let choices = []

  Object.keys(devices).forEach((runtime) => {
    const version = parseRuntimeToVersion(runtime)
    devices[runtime].forEach((device) => {
      const label = `${device.name} (${version}) - ${device.udid}`
      choices.push({
        name: label,
        value: device.udid,
        short: `${device.name} - ${device.udid}`,
      })
    })
  })

  if (choices.length === 0) {
    console.log(chalk.yellow("No available simulators to delete."))
    return
  }

  const answers = await inquirer.prompt([
    {
      type: "checkbox",
      name: "udidsToDelete",
      message: "Select simulators to delete:",
      choices: choices,
    },
    {
      type: "confirm",
      name: "proceed",
      message: "Are you sure you want to delete the selected simulators?",
      default: false,
    },
  ])

  if (answers.proceed && answers.udidsToDelete.length > 0) {
    try {
      for (const udid of answers.udidsToDelete) {
        await $`xcrun simctl delete ${udid}`
        console.log(
          chalk.green(`Simulator with UDID ${udid} deleted successfully.`),
        )
      }
    } catch (error) {
      console.error(chalk.red(`Failed to delete simulators: ${error}`))
    }
  } else {
    console.log(chalk.yellow("Deletion cancelled."))
  }
}

const bootSimulator = async () => {
  const devices = await fetchSimulators()
  let choices = []

  Object.keys(devices).forEach((runtime) => {
    devices[runtime].forEach((device) => {
      if (device.isAvailable && device.state !== "Booted") {
        const label = `${device.name} (${parseRuntimeToVersion(runtime)}) - ${
          device.udid
        }`
        choices.push({ name: label, value: device.udid })
      }
    })
  })

  if (choices.length === 0) {
    console.log(chalk.yellow("No available simulators to boot."))
    return
  }

  const { udid } = await inquirer.prompt([
    {
      type: "list",
      name: "udid",
      message: "Select a simulator to boot:",
      choices: choices,
    },
  ])

  try {
    await $`xcrun simctl boot ${udid}`
    console.log(chalk.green(`Simulator with UDID ${udid} booted successfully.`))
  } catch (error) {
    console.error(chalk.red(`Failed to boot simulator: ${error}`))
  }
}

const takeScreenshot = async () => {
  const devices = await fetchSimulators()
  let choices = []

  Object.keys(devices).forEach((runtime) => {
    devices[runtime].forEach((device) => {
      if (device.isAvailable && device.state === "Booted") {
        const label = `${device.name} (${parseRuntimeToVersion(runtime)}) - ${
          device.udid
        }`
        choices.push({ name: label, value: device.udid })
      }
    })
  })

  if (choices.length === 0) {
    console.log(
      chalk.yellow("No booted simulators available for taking a screenshot."),
    )
    return
  }

  const { udid } = await inquirer.prompt([
    {
      type: "list",
      name: "udid",
      message: "Select a simulator to take a screenshot of:",
      choices: choices,
    },
  ])

  const { savePath } = await inquirer.prompt([
    {
      type: "input",
      name: "savePath",
      message:
        "Enter the path to save the screenshot (include file name and extension):",
    },
  ])

  try {
    await $`xcrun simctl io ${udid} screenshot ${savePath}`
    console.log(chalk.green(`Screenshot saved to ${savePath}`))
  } catch (error) {
    console.error(chalk.red(`Failed to take screenshot: ${error}`))
  }
}

const main = async () => {
  yargs(hideBin(process.argv))
    .usage(
      chalk.blueBright("Usage: $0 <command> [options]") +
        "\n\n" +
        chalk.green("Commands:"),
    )
    .command(
      "list-remote",
      chalk.cyan("List all available remote simulators"),
      {},
      listRemoteSimulators,
    )
    .command(
      "list",
      chalk.cyan("List all available local simulators"),
      {},
      listSimulators,
    )
    .command(
      "create",
      chalk.cyan("Create a new simulator device"),
      {},
      createSimulator,
    )
    .command(
      "delete",
      chalk.cyan("Delete an existing simulator device"),
      {},
      deleteSimulator,
    )
    .command("boot", chalk.cyan("Boot a simulator device"), {}, bootSimulator)
    .command(
      "screenshot",
      chalk.cyan("Take a screenshot of a simulator"),
      {},
      takeScreenshot,
    )
    .demandCommand(1, chalk.red("Please specify a command."))
    .help(false)
    .alias("help", "h")
    .wrap(null)
    .epilog(chalk.yellowBright(`For more information, visit ${homepage}`))
    .version(version)
    .help()
    .parse()
}

main()
