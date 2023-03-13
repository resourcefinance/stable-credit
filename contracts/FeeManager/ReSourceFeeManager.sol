// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interface/IReSourceCreditIssuer.sol";
import "./FeeManager.sol";

/// @title ReSourceFeeManager
/// @author ReSource
/// @notice Extends the FeeManager contract to include custom fee calculation logic
contract ReSourceFeeManager is FeeManager {
    /* ========== INITIALIZER ========== */

    function initialize(address _stableCredit) external virtual initializer {
        __FeeManager_init(_stableCredit);
    }

    /* ========== VIEWS ========== */

    /// @notice calculate fee to charge member in reference token value
    /// @dev extends the base fee calculation to include a member fee rate provided by the
    /// ReSource credit issuer.
    /// @param amount stable credit amount to base fee off of
    /// @return reference token amount to charge given member
    function calculateMemberFee(address member, uint256 amount)
        public
        view
        override
        returns (uint256)
    {
        if (paused()) {
            return 0;
        }
        uint256 memberFeeRate = IReSourceCreditIssuer(address(stableCredit.creditIssuer()))
            .creditTermsOf(member).feeRate;

        uint256 memberFee = stableCredit.convertCreditToReferenceToken(
            (memberFeeRate * amount) / stableCredit.reservePool().riskOracle().SCALING_FACTOR()
        );

        return super.calculateMemberFee(member, amount) + memberFee;
    }
}
