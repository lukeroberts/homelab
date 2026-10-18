# One-time plaintext backfill for an existing Sure database.
# Stop web/worker writers first. Back up and restore-test the database first.
# Explicit keys and legacy-read compatibility must be configured before Rails boots.
# Run with CONFIRM_ENCRYPT_EXISTING_DATA=yes; calls Rails' supported #encrypt API.
raise "Backfill confirmation missing" unless ENV["CONFIRM_ENCRYPT_EXISTING_DATA"] == "yes"
raise "Explicit encryption keys missing" unless ActiveRecordEncryptionConfig.complete_env?
raise "Legacy-read compatibility is required for backfill" unless ActiveRecord::Encryption.config.support_unencrypted_data
Rails.application.eager_load!
connection = ApplicationRecord.connection
models = ApplicationRecord.descendants.reject(&:abstract_class?).select do |model|
  model.table_exists? && Array(model.encrypted_attributes).any?
end.sort_by(&:name)
raise "User encryption declarations missing" unless Array(User.encrypted_attributes).include?(:email)
report = []
ApplicationRecord.transaction do
  # Fail rather than wait indefinitely for an unexpected writer.
  connection.execute("SET LOCAL lock_timeout = '5s'")
  connection.execute("SET LOCAL statement_timeout = '120s'")
  models.each do |model|
    fields = model.encrypted_attributes.map(&:to_s)
    changed = 0
    model.unscoped.lock.find_each do |record|
      id = record.id
      select = "SELECT * FROM #{connection.quote_table_name(model.table_name)} WHERE #{connection.quote_column_name(model.primary_key)} = #{connection.quote(id)}"
      before = connection.select_one(select)
      next unless fields.any? { |field| !before[field].nil? && !ActiveRecord::Encryption.encryptor.encrypted?(before[field].to_s) }
      logical = fields.to_h { |field| [field, record.public_send(field)] }
      record.encrypt
      record.reload
      after = connection.select_one(select)
      raise "Non-encrypted columns changed in #{model.name}" unless before.except(*fields) == after.except(*fields)
      fields.each do |field|
        raise "Decrypted value changed in #{model.name}.#{field}" unless record.public_send(field) == logical[field]
        next if after[field].nil?
        raise "Plaintext remains in #{model.name}.#{field}" unless ActiveRecord::Encryption.encryptor.encrypted?(after[field].to_s)
      end
      changed += 1
    end
    report << { model: model.name, migrated_rows: changed } if changed.positive?
  end
  raise "User email lookup failed after backfill" unless User.all.all? { |user| User.find_by(email: user.email)&.id == user.id }
end
puts({ backfill_committed: true, tables: report }.to_json)
