// Replaced in step 5 (booking engine).
import type { BookingService } from "../../voice/tools";
export const bookingService: BookingService = {
  async findSlots() {
    return [];
  },
  async book() {
    throw new Error("booking not implemented yet");
  },
  inServiceArea() {
    return null;
  },
};
