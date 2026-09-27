import React from "react";
import { render } from "@testing-library/react-native";
import { EscrowQRCode } from "./EscrowQRCode";

jest.mock("react-native-qrcode-svg", () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

describe("EscrowQRCode", () => {
  it("generates a QR code using the canonical escrow share URL", () => {
    const mockQRCode = require("react-native-qrcode-svg").default;
    const escrowId = "550e8400-e29b-41d4-a716-446655440000";

    render(<EscrowQRCode escrowId={escrowId} />);

    expect(mockQRCode).toHaveBeenCalledWith(
      expect.objectContaining({
        value: `https://vaultix.app/escrow/${escrowId}`,
      }),
      {}
    );
  });
});
