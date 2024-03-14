#!/usr/bin/env node

import inquirer from "inquirer"
import chalk from "chalk"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { $ } from "zx"
import Table from "cli-table3"

$.verbose = false

const fetchSimulators = async () => {
  const { stdout } = await $`xcrun simctl list devices --json`
  return JSON.parse(stdout).devices
}

const parseRuntimeToVersion = (runtime) => {
  const match = runtime.match(/iOS-(\d+)-(\d+)/)

  return match ? `iOS ${match[1]}.${match[2]}` : "Unknown"
}

const listSimulators = async () => {
  const devices = await fetchSimulators()

  // Directly work with keys to sort and display devices.
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
    // Check if there are devices available for this runtime
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
  // Fetch available device types
  const deviceTypes = await getDeviceTypes()
  const deviceTypeChoices = deviceTypes.map((deviceType) => ({
    name: `${deviceType.name} (${deviceType.identifier})`,
    value: deviceType.identifier,
    short: deviceType.name, // Use short name for simplicity in naming
  }))

  // Fetch available runtimes
  const runtimes = await getRuntimes()
  const runtimeChoices = runtimes.map((runtime) => ({
    name: `${runtime.name} (${runtime.identifier})`,
    value: runtime.identifier,
    short: runtime.name.replace(/.*(iOS \d+.\d+).*/, "$1"), // Extract a simpler format, e.g., "iOS 14.5"
  }))

  // Prompt user to choose device type and runtime first
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

  // Generate a default name based on selections
  const deviceTypeName = deviceTypeChoices.find(
    (d) => d.value === deviceAndRuntime.deviceType,
  ).short
  const runtimeName = runtimeChoices.find(
    (r) => r.value === deviceAndRuntime.runtime,
  ).short
  const defaultSimulatorName = `${deviceTypeName} - ${runtimeName}`

  // Now prompt for the name, suggesting the default
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

  // Create a list of devices that can be booted
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

  // Let the user select a device to boot
  const { udid } = await inquirer.prompt([
    {
      type: "list",
      name: "udid",
      message: "Select a simulator to boot:",
      choices: choices,
    },
  ])

  // Boot the selected device
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

  // Create a list of booted devices
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

  // Let the user select a device to take a screenshot of
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

  // Take a screenshot of the selected device
  try {
    await $`xcrun simctl io ${udid} screenshot ${savePath}`
    console.log(chalk.green(`Screenshot saved to ${savePath}`))
  } catch (error) {
    console.error(chalk.red(`Failed to take screenshot: ${error}`))
  }
}

// const simulateNetworkCondition = async () => {
//   console.log(
//     chalk.yellow(
//       "Note: This feature requires Network Link Conditioner to be installed and enabled on your Mac.",
//     ),
//   )
//   const { condition } = await inquirer.prompt([
//     {
//       type: "list",
//       name: "condition",
//       message: "Select the network condition to simulate:",
//       choices: ["3G", "4G", "LTE", "WiFi", "Offline"],
//     },
//   ])

//   console.log(
//     chalk.green(
//       `Simulating ${condition} network condition. Please manually configure this in Network Link Conditioner settings.`,
//     ),
//   )
// }

// const resetSimulator = async () => {
//   const { udid } = await inquirer.prompt([
//     {
//       type: "input",
//       name: "udid",
//       message: "Enter the UDID of the simulator to reset:",
//     },
//   ])

//   try {
//     await $`xcrun simctl erase ${udid}`
//     console.log(chalk.green(`Simulator with UDID ${udid} reset successfully.`))
//   } catch (error) {
//     console.error(chalk.red(`Failed to reset simulator: ${error}`))
//   }
// }

const main = async () => {
  yargs(hideBin(process.argv))
    .command("list", "List all available simulators", {}, listSimulators)
    .command("create", "Create a new simulator device", {}, createSimulator)
    .command(
      "delete",
      "Delete an existing simulator device",
      {},
      deleteSimulator,
    )
    .command("boot", "Boot a simulator device", {}, bootSimulator)
    .command(
      "screenshot",
      "Take a screenshot of a simulator",
      {},
      takeScreenshot,
    )
    // .command(
    //   "network",
    //   "Simulate network conditions",
    //   {},
    //   simulateNetworkCondition,
    // )
    // .command(
    //   "reset",
    //   "Reset a simulator to its initial state",
    //   {},
    //   resetSimulator,
    // )
    .demandCommand(1, "Please specify a command.")
    .help()
    .alias("help", "h").argv
}

main()
