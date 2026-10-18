# Run with: bin/rails runner /path/to/verify_encryption.rb
# Read-only. Reports counts, never decrypted values, keys, or exception messages.
raise "Explicit encryption keys are not configured" unless ActiveRecordEncryptionConfig.complete_env?
Rails.application.eager_load!
connection = ApplicationRecord.connection
models = ApplicationRecord.descendants.reject(&:abstract_class?).select do |model|
  model.table_exists? && Array(model.encrypted_attributes).any?
end.sort_by(&:name)
raise "User encryption declarations missing" unless Array(User.encrypted_attributes).include?(:email)
raise "SSO encryption declarations missing" unless Array(SsoProvider.encrypted_attributes).include?(:client_secret)
report = []
models.each do |model|
  fields = model.encrypted_attributes.map(&:to_s)
  rows = connection.select_all("SELECT * FROM #{connection.quote_table_name(model.table_name)}")
  count = 0
  rows.each do |row|
    record = model.unscoped.find(row.fetch(model.primary_key))
    fields.each do |field|
      next if row[field].nil?
      raise "Plaintext remains in #{model.name}.#{field}" unless ActiveRecord::Encryption.encryptor.encrypted?(row[field].to_s)
      begin
        record.public_send(field)
      rescue StandardError
        raise "Cannot decrypt #{model.name}.#{field}"
      end
      count += 1
    end
  end
  report << { model: model.name, rows: rows.length, encrypted_fields: count } if rows.any?
end
raise "User email lookup failed" unless User.all.all? { |user| User.find_by(email: user.email)&.id == user.id }
puts({ encryption_verified: true, plaintext_compatibility: ActiveRecord::Encryption.config.support_unencrypted_data, tables: report, users: User.count, accounts: Account.count, oidc_identities: OidcIdentity.count }.to_json)
