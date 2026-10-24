import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CapacityBar } from "./CapacityBar";

describe("CapacityBar", () => {
  it("renders used/total and a bounded progressbar", () => {
    render(<CapacityBar label="Storage" used={10} total={40} />);
    expect(screen.getByText("10 / 40")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Storage" });
    expect(bar).toHaveAttribute("aria-valuenow", "10");
    expect(bar).toHaveAttribute("aria-valuemax", "40");
  });

  it("shows unlimited when total is null", () => {
    render(<CapacityBar label="Slots" used={3} total={null} />);
    expect(screen.getByText("3 / ∞")).toBeInTheDocument();
  });

  it("flags an anomaly and clamps when used exceeds capacity", () => {
    render(<CapacityBar label="Storage" used={50} total={40} />);
    expect(
      screen.getByText(/Reported usage exceeds capacity/),
    ).toBeInTheDocument();
  });

  it("clamps negative values to zero", () => {
    render(<CapacityBar label="Storage" used={-5} total={40} />);
    expect(screen.getByText("0 / 40")).toBeInTheDocument();
  });
});
