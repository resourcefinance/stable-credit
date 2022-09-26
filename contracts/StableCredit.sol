// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/metatx/MinimalForwarder.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./CIP36Upgradeable.sol";
import "./interface/IAccessManager.sol";
import "./interface/IStableCredit.sol";
import "./interface/IFeeManager.sol";
import "./interface/ISavingsPool.sol";
import "./interface/IReservePool.sol";

/// @title StableCreditDemurrage contract
/// @author ReSource
/// @notice Extends the ERC20 standard to include mutual credit functionality where users
/// can mint tokens into existence by utilizing their lines of credit. Credit defaults result
/// in either a savings pool demurrage or a transfer of credit to the network debt balance.
/// @dev Restricted functions are only callable by network operators.

contract StableCredit is CIP36Upgradeable, IStableCredit {
    /* ========== CONSTANTS ========== */
    uint32 private constant MIN_PPT = 1000;

    /* ========== STATE VARIABLES ========== */
    uint256 public creditExpiration;
    uint256 public pastDueExpiration;
    uint256 public conversionRate;
    uint256 public demurraged;
    uint256 public demurrageIndex;
    uint256 public networkDebt;
    mapping(address => uint256) private demurrageIndexOf;
    mapping(address => uint256) public creditIssuance;
    IAccessManager public access;
    IFeeManager public feeManager;
    ISavingsPool public savingsPool;
    IReservePool public reservePool;
    IERC20Upgradeable public feeToken;

    /* ========== INITIALIZER ========== */

    function initialize(
        address _accessManager,
        address _feeToken,
        string memory name_,
        string memory symbol_
    ) external virtual initializer {
        access = IAccessManager(_accessManager);
        feeToken = IERC20Upgradeable(_feeToken);
        __CIP36_init(name_, symbol_);
        demurrageIndex = 1;
        conversionRate = 1e18;
    }

    /* ========== VIEWS ========== */
    function balanceOf(address _member)
        public
        view
        override(IStableCredit, ERC20Upgradeable)
        returns (uint256)
    {
        uint256 burnable = demurragedBalanceOf(_member);
        if (burnable == 0) return super.balanceOf(_member);
        return (super.balanceOf(_member) * conversionRate) / 1e18;
    }

    function demurragedBalanceOf(address _member) public view returns (uint256) {
        if (
            demurrageIndexOf[_member] == demurrageIndex ||
            super.balanceOf(_member) == 0 ||
            demurraged == 0
        ) return 0;
        uint256 balance = (super.balanceOf(_member) * conversionRate) / 1e18;
        return super.balanceOf(_member) - balance;
    }

    function convertCreditToFeeToken(uint256 amount)
        public
        view
        override
        returns (uint256 conversion)
    {
        uint256 feeDecimals = IERC20Metadata(address(feeToken)).decimals();
        uint256 creditDecimals = decimals();
        creditDecimals < feeDecimals
            ? conversion = ((amount * 10**(feeDecimals - creditDecimals)))
            : conversion = ((amount / 10**(creditDecimals - feeDecimals)));
    }

    function isAuthorized(address _member) public view override returns (bool) {
        return access.isNetworkOperator(_member) || _member == owner();
    }

    function inDefault(address _member) public view returns (bool) {
        uint256 issueDate = creditIssuance[_member];
        return block.timestamp >= issueDate + creditExpiration + pastDueExpiration;
    }

    function isPastDue(address _member) public view returns (bool) {
        uint256 issueDate = creditIssuance[_member];
        return block.timestamp >= issueDate + pastDueExpiration && !inDefault(_member);
    }

    function getReservePool() external view override returns (address) {
        return address(reservePool);
    }

    function getFeeToken() external view override returns (address) {
        return address(feeToken);
    }

    /* ========== PUBLIC FUNCTIONS ========== */
    function _transfer(
        address _from,
        address _to,
        uint256 _amount
    ) internal override onlyMembers(_from, _to) {
        uint256 balanceFrom = balanceOf(_from);
        if (_amount > balanceFrom && !validateCreditLine(_from)) return;
        feeManager.collectFees(_from, _to, _amount);
        if (demurrageIndexOf[_to] != demurrageIndex) burnDemurraged(_to);
        if (demurrageIndexOf[_from] != demurrageIndex) burnDemurraged(_from);
        super._transfer(_from, _to, _amount);
    }

    function validateCreditLine(address _member) public returns (bool) {
        require(creditLimitOf(_member) > 0, "StableCredit: member does not have a credit line");
        // renew if using creditline while past due and outstanding debt is zero
        if (creditBalanceOf(_member) == 0 && isPastDue(_member)) {
            creditIssuance[_member] = block.timestamp;
            return true;
        }
        require(!isPastDue(_member), "StableCredit: Credit line is past due");
        if (inDefault(_member)) {
            defaultCreditLine(_member);
            return false;
        }
        return true;
    }

    /// @notice burns network debt and reimburses caller with reserve tokens
    function burnNetworkDebt(uint256 _amount) public {
        require(balanceOf(msg.sender) >= _amount, "StableCredit: Insufficient balance");
        require(_amount <= networkDebt, "StableCredit: Insufficient network debt");
        burnDemurraged(msg.sender);
        _burn(msg.sender, _amount);
        networkDebt -= _amount;
        reservePool.reimburseMember(msg.sender, convertCreditToFeeToken(_amount));
        emit NetworkDebtBurned(msg.sender, _amount);
    }

    function burnDemurraged(address _member) public {
        uint256 burnAmount = demurragedBalanceOf(_member);
        demurrageIndexOf[_member] = demurrageIndex;
        if (burnAmount == 0) return;
        _burn(_member, burnAmount);
        demurraged -= burnAmount;
        reservePool.reimburseMember(_member, convertCreditToFeeToken(burnAmount));
    }

    function repayCreditBalance(uint128 _amount) external {
        uint256 balance = creditBalanceOf(msg.sender);
        require(_amount <= balance, "StableCredit: invalid amount");
        feeToken.transferFrom(msg.sender, address(reservePool), _amount);
        uint256 leftover = savingsPool.demurrage(msg.sender, creditBalanceOf(msg.sender));
        if (leftover != 0) networkDebt += leftover;
        _members[msg.sender].creditBalance -= _amount;
        emit CreditBalanceRepayed(_amount);
    }

    /* ========== PRIVATE FUNCTIONS ========== */

    function defaultCreditLine(address _member) internal virtual {
        uint256 creditBalance = creditBalanceOf(_member);
        uint256 leftover = savingsPool.demurrage(_member, creditBalance);
        if (leftover != 0) networkDebt += leftover;
        _members[_member].creditBalance = 0;
        _members[_member].creditLimit = 0;
        delete creditIssuance[_member];
        emit CreditDefault(_member);
    }

    function updateConversionRate() private {
        if (demurraged == 0) return;
        conversionRate = 1e18 - (demurraged * 1e18) / totalSupply();
    }

    /* ========== RESTRICTED FUNCTIONS ========== */
    function createCreditLine(
        address _member,
        uint256 _creditLimit,
        uint256 _balance
    ) external onlyAuthorized {
        require(
            creditIssuance[_member] == 0,
            "StableCredit: Credit line already exists for member"
        );
        if (!access.isMember(_member)) access.grantMember(_member);
        creditIssuance[_member] = block.timestamp;
        setCreditLimit(_member, _creditLimit);
        demurrageIndexOf[_member] = demurrageIndex;
        if (_balance > 0) {
            _mint(_member, _balance);
            networkDebt += _balance;
        }
        emit CreditLineCreated(_member, _creditLimit, block.timestamp);
    }

    function extendCreditLine(address _member, uint256 _creditLimit) external onlyAuthorized {
        require(creditIssuance[_member] > 0, "StableCredit: Credit line does not exist for member");
        uint256 curCreditLimit = creditLimitOf(_member);
        require(curCreditLimit < _creditLimit, "invalid credit limit");
        setCreditLimit(_member, _creditLimit);
        emit CreditLimitExtended(_member, _creditLimit);
    }

    function demurrageMembers(uint256 _amount) external onlyAuthorized {
        require(networkDebt >= _amount, "StableCredit: Insufficient network debt");
        demurraged += _amount;
        updateConversionRate();
        demurrageIndex++;
        emit MembersDemurraged(_amount);
    }

    function setSavingsPool(address _savingsPool) external onlyAuthorized {
        savingsPool = ISavingsPool(_savingsPool);
    }

    function setReservePool(address _reservePool) external onlyAuthorized {
        reservePool = IReservePool(_reservePool);
    }

    function setFeeManager(address _feeManager) external onlyAuthorized {
        feeManager = IFeeManager(_feeManager);
    }

    function setCreditExpiration(uint256 _seconds) external onlyAuthorized {
        require(_seconds > 0, "expiration must be greater than 0 seconds");
        creditExpiration = _seconds;
        emit CreditExpirationUpdated(creditExpiration);
    }

    function setPastDueExpiration(uint256 _seconds) external onlyAuthorized {
        require(_seconds > 0, "expiration must be greater than 0 seconds");
        pastDueExpiration = _seconds;
        emit PastDueExpirationUpdated(pastDueExpiration);
    }

    /* ========== MODIFIERS ========== */

    modifier onlyMembers(address _from, address _to) {
        require(
            access.isMember(_from) || access.isNetworkOperator(_from),
            "Sender is not network member"
        );
        require(
            access.isMember(_to) || access.isNetworkOperator(_to),
            "Recipient is not network member"
        );
        _;
    }

    modifier onlyAuthorized() override {
        require(isAuthorized(msg.sender), "Unauthorized caller");
        _;
    }
}
