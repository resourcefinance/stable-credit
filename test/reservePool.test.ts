import { ethers } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import chai from "chai"
import { solidity } from "ethereum-waffle"
import { NetworkContracts, stableCreditFactory } from "./stableCreditFactory"
import {
  stableCreditsToString,
  stringToStableCredits,
  stringToEth,
  ethToString,
} from "../utils/utils"

chai.use(solidity)

describe("Reserve Pool Tests", function () {
  let contracts: NetworkContracts
  let memberA: SignerWithAddress
  let memberB: SignerWithAddress
  let memberC: SignerWithAddress
  let memberD: SignerWithAddress
  let memberE: SignerWithAddress
  let memberF: SignerWithAddress

  this.beforeEach(async function () {
    const accounts = await ethers.getSigners()
    memberA = accounts[1]
    memberB = accounts[2]
    memberC = accounts[3]
    memberD = accounts[4]
    memberE = accounts[5]
    memberF = accounts[6]

    contracts = await stableCreditFactory.deployWithSupply()
    await ethers.provider.send("evm_increaseTime", [10])
    await ethers.provider.send("evm_mine", [])
  })
  it("Network demurraged tokens fully reimburse members when burned", async function () {
    // deposit reserve collateral
    await expect(contracts.reservePool.depositCollateral(stringToEth("100000"))).to.not.be.reverted
    // default Credit Line A
    await ethers.provider.send("evm_increaseTime", [100])
    await ethers.provider.send("evm_mine", [])
    await expect(contracts.stableCredit.validateCreditLine(memberA.address)).to.not.be.reverted

    await expect(contracts.stableCredit.demurrageMembers(stringToStableCredits("10.0"))).to.not.be
      .reverted

    expect(ethToString(await contracts.mockFeeToken.balanceOf(memberB.address))).to.equal("0.0")

    await expect(contracts.stableCredit.burnDemurraged(memberB.address)).to.not.be.reverted

    expect(stableCreditsToString(await contracts.stableCredit.balanceOf(memberB.address))).to.equal(
      "6.666666"
    )

    expect(ethToString(await contracts.mockFeeToken.balanceOf(memberB.address))).to.equal(
      "3.333334"
    )
  })
  it("Network demurraged tokens partially reimburse members when burned", async function () {
    // deposit reserve collateral
    await expect(contracts.reservePool.depositCollateral(stringToEth("3.0"))).to.not.be.reverted
    // default Credit Line A
    await ethers.provider.send("evm_increaseTime", [100])
    await ethers.provider.send("evm_mine", [])
    await expect(contracts.stableCredit.validateCreditLine(memberA.address)).to.not.be.reverted
    await expect(contracts.stableCredit.demurrageMembers(stringToStableCredits("10.0"))).to.not.be
      .reverted

    expect(ethToString(await contracts.mockFeeToken.balanceOf(memberB.address))).to.equal("0.0")

    await expect(contracts.stableCredit.burnDemurraged(memberB.address)).to.not.be.reverted

    expect(stableCreditsToString(await contracts.stableCredit.balanceOf(memberB.address))).to.equal(
      "6.666666"
    )

    expect(ethToString(await contracts.mockFeeToken.balanceOf(memberB.address))).to.equal("3.0")
  })
  it("Savings demurraged tokens fully reimburse savers", async function () {
    contracts = await stableCreditFactory.deployWithSavings()

    await expect(contracts.reservePool.depositCollateral(stringToEth("100000"))).to.not.be.reverted

    // default Credit Line A
    await ethers.provider.send("evm_increaseTime", [110])
    await ethers.provider.send("evm_mine", [])
    // await expect(contracts.stableCredit.validateCreditLine(memberA.address)).to.not.be.reverted
    await (await contracts.stableCredit.validateCreditLine(memberA.address)).wait()

    expect(stableCreditsToString(await contracts.savingsPool.balanceOf(memberB.address))).to.equal(
      "1.666666"
    )

    expect(ethToString(await contracts.savingsPool.earnedReimbursement(memberB.address))).to.equal(
      "3.333334"
    )
  })
  it("Savings demurraged tokens partially reimburse savers", async function () {
    await expect(contracts.reservePool.depositCollateral(stringToEth("3"))).to.not.be.reverted

    await (await contracts.savingsPool.connect(memberB).stake(stringToStableCredits("5"))).wait()
    await (await contracts.savingsPool.connect(memberD).stake(stringToStableCredits("5"))).wait()
    await (await contracts.savingsPool.connect(memberF).stake(stringToStableCredits("5"))).wait()

    // default Credit Line A
    await ethers.provider.send("evm_increaseTime", [100])
    await ethers.provider.send("evm_mine", [])
    await (await contracts.stableCredit.validateCreditLine(memberA.address)).wait()
    // await expect(contracts.stableCredit.validateCreditLine(memberA.address)).to.not.be.reverted

    expect(stableCreditsToString(await contracts.savingsPool.balanceOf(memberB.address))).to.equal(
      "1.666666"
    )

    expect(ethToString(await contracts.savingsPool.earnedReimbursement(memberB.address))).to.equal(
      "1.0000002"
    )
  })
  it("Configuring operator percent updates swapSink percent", async function () {
    expect(await (await contracts.reservePool.swapSinkPercent()).toNumber()).to.equal(500000)
    expect(await (await contracts.reservePool.operatorPercent()).toNumber()).to.equal(500000)

    await expect(contracts.reservePool.updateOperatorPercent(200000)).to.not.be.reverted

    expect(await (await contracts.reservePool.swapSinkPercent()).toNumber()).to.equal(800000)
    expect(await (await contracts.reservePool.operatorPercent()).toNumber()).to.equal(200000)
  })

  it("depositing collateral updates reserve LTV", async function () {
    await expect(contracts.reservePool.depositCollateral(stringToEth("15.0"))).to.not.be.reverted
    expect(ethToString(await contracts.reservePool.collateral())).to.equal("15.0")
    // LTV should be 50%
    expect(await (await contracts.reservePool.LTV()).toNumber()).to.equal(500000)
    await expect(contracts.reservePool.depositCollateral(stringToEth("15.0"))).to.not.be.reverted
    expect(ethToString(await contracts.reservePool.collateral())).to.equal("30.0")
    // LTV should be 100%
    expect(await (await contracts.reservePool.LTV()).toNumber()).to.equal(1000000)
  })

  it("needed collateral is updated when LTV changes", async function () {
    expect(await (await contracts.reservePool.minLTV()).toNumber()).to.equal(200000)
    expect(ethToString(await contracts.reservePool.getNeededCollateral())).to.equal("6.0")
    await expect(contracts.reservePool.depositCollateral(stringToEth("5.0"))).to.not.be.reverted
    expect(ethToString(await contracts.reservePool.collateral())).to.equal("5.0")
    // LTV should be 16%
    expect(await (await contracts.reservePool.LTV()).toNumber()).to.equal(166666)
    // needed is really 1.0 but results in 1.00002 from rounding
    expect(ethToString(await contracts.reservePool.getNeededCollateral())).to.equal("1.00002")
    await expect(contracts.reservePool.depositCollateral(stringToEth("1.0"))).to.not.be.reverted
    expect(ethToString(await contracts.reservePool.collateral())).to.equal("6.0")
    expect(await (await contracts.reservePool.LTV()).toNumber()).to.equal(200000)
  })

  it("Expanding stable credit supply updates reserve LTV", async function () {
    await expect(contracts.reservePool.depositCollateral(stringToEth("15.0"))).to.not.be.reverted
    // 30 / 15 = 50%
    expect(await (await contracts.reservePool.LTV()).toNumber()).to.equal(500000)
    // expand supply
    await expect(
      contracts.stableCredit
        .connect(memberA)
        .transfer(memberB.address, stringToStableCredits("10.0"))
    ).to.not.be.reverted
    // 40 / 15 = 37.5%
    expect(await (await contracts.reservePool.LTV()).toNumber()).to.equal(375000)
  })

  it("Distributing fees to reserve with fully insufficient collateral adds only to collateral", async function () {
    // unpuase fee collection
    await expect(contracts.feeManager.unpauseFees()).to.not.be.reverted

    await expect(
      contracts.mockFeeToken
        .connect(memberA)
        .approve(contracts.feeManager.address, ethers.constants.MaxUint256)
    ).to.not.be.reverted

    await expect(contracts.mockFeeToken.transfer(memberA.address, stringToEth("20"))).to.not.be
      .reverted

    await expect(
      contracts.stableCredit.connect(memberA).transfer(memberB.address, stringToStableCredits("20"))
    ).to.not.be.reverted

    expect(ethToString(await contracts.reservePool.collateral())).to.equal("0.0")

    // because savings pool is empty, all fees will go to reserve
    await expect(contracts.feeManager.distributeFees()).to.not.be.reverted

    expect(ethToString(await contracts.reservePool.collateral())).to.equal("4.0")
    expect(ethToString(await contracts.reservePool.swapSink())).to.equal("0.0")
    expect(ethToString(await contracts.reservePool.operatorBalance())).to.equal("0.0")
  })

  it("Distributing fees to reserve with partially sufficient collateral adds to collateral first", async function () {
    await expect(contracts.reservePool.depositCollateral(stringToEth("7"))).to.not.be.reverted
    // unpuase fee collection
    await expect(contracts.feeManager.unpauseFees()).to.not.be.reverted

    await expect(
      contracts.mockFeeToken
        .connect(memberA)
        .approve(contracts.feeManager.address, ethers.constants.MaxUint256)
    ).to.not.be.reverted

    await expect(contracts.mockFeeToken.transfer(memberA.address, stringToEth("20"))).to.not.be
      .reverted

    await expect(
      contracts.stableCredit.connect(memberA).transfer(memberB.address, stringToStableCredits("10"))
    ).to.not.be.reverted

    expect(ethToString(await contracts.reservePool.collateral())).to.equal("7.0")
    expect(ethToString(await contracts.reservePool.swapSink())).to.equal("0.0")
    expect(ethToString(await contracts.reservePool.operatorBalance())).to.equal("0.0")

    await expect(contracts.feeManager.distributeFees()).to.not.be.reverted

    // min LTV is 20% (8 collateral is 20% of totalSupply 40)
    expect(ethToString(await contracts.reservePool.collateral())).to.equal("8.0")
    expect(ethToString(await contracts.reservePool.swapSink())).to.equal("0.5")
    expect(ethToString(await contracts.reservePool.operatorBalance())).to.equal("0.5")
  })

  it("Withdrawing operator balance transfers and updates operator balance", async function () {
    await expect(contracts.accessManager.grantOperator(memberF.address)).to.not.be.reverted
    await expect(
      contracts.mockFeeToken.approve(contracts.reservePool.address, ethers.constants.MaxUint256)
    ).to.not.be.reverted
    await expect(contracts.reservePool.depositCollateral(stringToEth("1000"))).to.not.be.reverted

    await expect(contracts.reservePool.depositFees(stringToEth("100"))).to.not.be.reverted

    expect(ethToString(await contracts.reservePool.operatorBalance())).to.equal("50.0")

    expect(ethToString(await contracts.mockFeeToken.balanceOf(memberF.address))).to.equal("0.0")
    await expect(contracts.reservePool.connect(memberF).withdrawOperator(stringToEth("50"))).to.not
      .be.reverted
    expect(ethToString(await contracts.mockFeeToken.balanceOf(memberF.address))).to.equal("50.0")
    expect(ethToString(await contracts.reservePool.operatorBalance())).to.equal("0.0")
  })
})
