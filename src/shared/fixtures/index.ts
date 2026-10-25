// Explicit test/development import only. Never mounted by the production server.
import data from './cases.json' with { type: 'json' };
import {
  CompanionSessionSchema, NotificationSchema, ProviderFailureSchema,
  ResultVersionSchema, RunSchema, VersionLinkSchema,
} from '../contracts.js';

export const fixtureMetadata = { fixtureType: data.fixtureType, contractVersion: data.contractVersion, disclaimer: data.disclaimer };
export const successFixture = ResultVersionSchema.parse(data.success.version);
export const conflictFixture = ResultVersionSchema.parse(data.conflict.version);
export const insufficientFixture = ResultVersionSchema.parse(data.insufficient.version);
export const providerFailureFixture = {
  run: RunSchema.parse(data['provider-failure'].run), failure: ProviderFailureSchema.parse(data['provider-failure'].failure), version: null,
};
export const updatedVersionFixture = {
  before: ResultVersionSchema.parse(data['updated-version'].before), after: ResultVersionSchema.parse(data['updated-version'].after),
  link: VersionLinkSchema.parse(data['updated-version'].link),
  oldCompanion: CompanionSessionSchema.parse(data['updated-version'].oldCompanion),
  notification: NotificationSchema.parse(data['updated-version'].notification),
};
