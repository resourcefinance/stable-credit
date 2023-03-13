// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ICreditIssuer {
    struct CreditPeriod {
        uint256 issueTimestamp;
        uint256 expirationTimestamp;
    }

    /// @notice called by the StableCredit contract when members transfer credits.
    /// @param from sender address of stable credit transaction.
    /// @param to recipient address of stable credit transaction.
    /// @param amount of credits in transaction.
    /// @return transaction validation result.
    function validateTransaction(address from, address to, uint256 amount)
        external
        returns (bool);

    /* ========== EVENTS ========== */

    event CreditLineDefaulted(address member);

    event CreditPeriodExpired(address member);

    event CreditPeriodCreated(address member, uint256 defaultTime);
}