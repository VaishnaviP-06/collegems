import mongoose from "mongoose";

const installmentSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: 0,
  },

  paidOn: {
    type: Date,
    default: Date.now,
  },

  idempotencyKey: {
    type: String,
  },

  // Payments submitted by a student/parent start as "pending" and only
  // count toward `paid` once a staff member (hod) confirms them - see
  // POST /api/fee/pay vs POST /api/fee/installments/:feeId/:installmentId/confirm.
  // Installments created directly by staff (e.g. via /fee/set or the seeder)
  // default to "confirmed" since there's nothing to verify.
  status: {
    type: String,
    enum: ["pending", "confirmed", "rejected"],
    default: "confirmed",
  },

  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  confirmedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  confirmedAt: {
    type: Date,
  },
});