import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import {
  AccessManager__factory,
  ReservePool__factory,
  StableCredit__factory,
  ReSourceCreditIssuer__factory
} from "../types"
import { deployProxyAndSaveAs, getConfig } from "../utils/utils"

const func: DeployFunction = async function (hardhat: HardhatRuntimeEnvironment) {

  let {symbol, name, reserveTokenAddress, adminOwner, riskOracleAddress} = getConfig();

  // ============ Deploy Contracts ============ //

  // deploy access manager
  let accessManagerAddress = (await hardhat.deployments.getOrNull(symbol + "_AccessManager"))
    ?.address
  if (!accessManagerAddress) {
    const accessManagerAbi = (await hardhat.artifacts.readArtifact("AccessManager")).abi
    const accessManagerArgs = [(await hardhat.ethers.getSigners())[0].address]
    accessManagerAddress = await deployProxyAndSaveAs(
      "AccessManager",
      symbol + "_AccessManager",
      accessManagerArgs,
      hardhat,
      accessManagerAbi
    )
  }

  let stableCreditAddress = (await hardhat.deployments.getOrNull(symbol + "_StableCredit"))?.address
  // deploy stable credit
  if (!stableCreditAddress) {
    const stableCreditAbi = (await hardhat.artifacts.readArtifact("StableCredit")).abi
    const stableCreditArgs = [name, symbol, accessManagerAddress]
    stableCreditAddress = await deployProxyAndSaveAs(
      "StableCredit",
      symbol + "_StableCredit",
      stableCreditArgs,
      hardhat,
      stableCreditAbi,
      { initializer: "__StableCredit_init" }
    )
  }

  // deploy reservePool
  let reservePoolAddress = (await hardhat.deployments.getOrNull(symbol + "_ReservePool"))?.address
  if (!reservePoolAddress) {
    const reservePoolAbi = (await hardhat.artifacts.readArtifact("ReservePool")).abi
    const reservePoolArgs = [
      stableCreditAddress,
      reserveTokenAddress,
      (await hardhat.ethers.getSigners())[0].address,
      riskOracleAddress,
    ]
    reservePoolAddress = await deployProxyAndSaveAs(
      "ReservePool",
      symbol + "_ReservePool",
      reservePoolArgs,
      hardhat,
      reservePoolAbi
    )
  }

  // deploy feeManager
  let feeManagerAddress = (await hardhat.deployments.getOrNull(symbol + "_FeeManager"))?.address
  if (!feeManagerAddress) {
    const feeManagerAbi = (await hardhat.artifacts.readArtifact("ReSourceFeeManager")).abi
    const feeManagerArgs = [stableCreditAddress]
    feeManagerAddress = await deployProxyAndSaveAs(
      "ReSourceFeeManager",
      symbol + "_FeeManager",
      feeManagerArgs,
      hardhat,
      feeManagerAbi
    )
  }

  // deploy creditIssuer
  let creditIssuerAddress = (await hardhat.deployments.getOrNull(symbol + "_CreditIssuer"))?.address
  if (!creditIssuerAddress) {
    const creditIssuerAbi = (await hardhat.artifacts.readArtifact("ReSourceCreditIssuer")).abi
    const creditIssuerArgs = [stableCreditAddress]
    creditIssuerAddress = await deployProxyAndSaveAs(
      "ReSourceCreditIssuer",
      symbol + "_CreditIssuer",
      creditIssuerArgs,
      hardhat,
      creditIssuerAbi
    )
  }

  // deploy credit pool
  let creditPoolAddress = (await hardhat.deployments.getOrNull(symbol + "_CreditPool"))?.address
  if (!creditPoolAddress) {
    const creditPoolAbi = (await hardhat.artifacts.readArtifact("CreditPool")).abi
    const creditPoolArgs = [stableCreditAddress]
    creditPoolAddress = await deployProxyAndSaveAs(
      "CreditPool",
      symbol + "_CreditPool",
      creditPoolArgs,
      hardhat,
      creditPoolAbi
    )
  }

  // deploy launch pool
  let launchPoolAddress = (await hardhat.deployments.getOrNull(symbol + "_LaunchPool"))?.address
  if (!launchPoolAddress) {
    const launchPoolAbi = (await hardhat.artifacts.readArtifact("LaunchPool")).abi
    const launchPoolArgs = [stableCreditAddress, creditPoolAddress, 30 * 24 * 60 * 60]
    launchPoolAddress = await deployProxyAndSaveAs(
      "LaunchPool",
      symbol + "_LaunchPool",
      launchPoolArgs,
      hardhat,
      launchPoolAbi
    )
  }
  
  // ============ Initialize Contracts State ============ //

  const stableCredit = StableCredit__factory.connect(
    stableCreditAddress,
    (await ethers.getSigners())[0]
  )
  const accessManager = AccessManager__factory.connect(
    accessManagerAddress,
    (await ethers.getSigners())[0]
  )
  const reservePool = ReservePool__factory.connect(
    reservePoolAddress,
    (await ethers.getSigners())[0]
  )
  const creditIssuer = ReSourceCreditIssuer__factory.connect(
    creditIssuerAddress,
    (await ethers.getSigners())[0]
  )

  // grant adminOwner admin access
  await (await accessManager.grantAdmin(adminOwner)).wait()
  // grant stableCredit operator access
  await (await accessManager.grantOperator(stableCreditAddress)).wait()
  // grant creditIssuer operator access
  await (await accessManager.grantOperator(creditIssuerAddress)).wait()
  // grant launchPool operator access
  await (await accessManager.grantOperator(launchPoolAddress)).wait()
  // grant creditPool operator access
  await (await accessManager.grantOperator(creditPoolAddress)).wait()
  // set accessManager
  await (await stableCredit.setAccessManager(accessManagerAddress)).wait()
  // set feeManager
  await (await stableCredit.setFeeManager(feeManagerAddress)).wait()
  // set creditIssuer
  await (await stableCredit.setCreditIssuer(creditIssuerAddress)).wait()
  // set feeManager
  await (await stableCredit.setFeeManager(feeManagerAddress)).wait()
  // set reservePool
  await (await stableCredit.setReservePool(reservePoolAddress)).wait()
  // set targetRTD to 20%
  await (await reservePool.setTargetRTD(20e16.toString())).wait()
  // set periodLength to 90 days
  await (await creditIssuer.setPeriodLength(90 * 24 * 60 * 60)).wait()
  // set gracePeriod length to 30 days
  await (await creditIssuer.setGracePeriodLength(30 * 24 * 60 * 60)).wait()
  // transfer admin ownership to adminOwner address
  await upgrades.admin.transferProxyAdminOwnership(adminOwner);
  // revoke signer admin access
  await (await accessManager.revokeAdmin((await hardhat.ethers.getSigners())[0].address)).wait()
}

export default func
func.tags = ["NETWORK"]
