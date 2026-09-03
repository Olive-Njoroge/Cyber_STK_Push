import mongoose from 'mongoose';

export const STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'STALE'];

const transactionSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, required: true, index: true, match: /^254[71]\d{8}$/ },
    amount: { type: Number, required: true, min: 1 },
    customerName: { type: String, default: '', trim: true },

    externalReference: { type: String, required: true, unique: true, index: true },
    checkoutRequestId: { type: String, default: '', index: true },
    payheroReference: { type: String, default: '', index: true },

    status: { type: String, enum: STATUSES, default: 'PENDING', index: true },
    resultCode: { type: String, default: '' },
    resultDescription: { type: String, default: '' },
    mpesaReceipt: { type: String, default: '' },

    lastVerifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The table is always "newest first", usually filtered to today.
transactionSchema.index({ createdAt: -1 });
// The stale sweep and the resend guard both scan by status + age.
transactionSchema.index({ status: 1, createdAt: -1 });

transactionSchema.methods.toClientJSON = function toClientJSON() {
  return {
    id: this._id.toString(),
    phoneNumber: this.phoneNumber,
    amount: this.amount,
    customerName: this.customerName,
    externalReference: this.externalReference,
    status: this.status,
    resultCode: this.resultCode,
    resultDescription: this.resultDescription,
    mpesaReceipt: this.mpesaReceipt,
    lastVerifiedAt: this.lastVerifiedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Transaction = mongoose.model('Transaction', transactionSchema);
